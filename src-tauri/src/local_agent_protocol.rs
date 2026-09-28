use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

#[cfg(windows)]
use process_wrap::tokio::JobObject;
#[cfg(unix)]
use process_wrap::tokio::ProcessGroup;
use process_wrap::tokio::{ChildWrapper, CommandWrap, KillOnDrop};
use serde_json::{json, Value};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStderr, ChildStdin, ChildStdout, Command};
use tokio_util::sync::CancellationToken;

use crate::local_agent::{
    LocalAgentEvent, LocalAgentModel, LocalAgentProvider, LocalAgentStartRequest,
};

const MAX_JSON_LINE_BYTES: usize = 4 * 1024 * 1024;
const MAX_PROTOCOL_OUTPUT_BYTES: usize = 32 * 1024 * 1024;
const MAX_PROTOCOL_EVENTS: usize = 250_000;
const MAX_DIAGNOSTIC_BYTES: usize = 64 * 1024;
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(30);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(4);
const CODEX_MCP_TOKEN_ENV: &str = "OPEN_BUILDER_MCP_TOKEN";
const CLAUDE_ISOLATION_ERROR: &str = "This Claude CLI cannot prove tool and configuration isolation before receiving user content. Upgrade to a Claude CLI that provides a pre-input structured isolation handshake.";

pub struct ProtocolContext {
    pub executable: PathBuf,
    pub request: LocalAgentStartRequest,
    pub run_dir: PathBuf,
    pub bridge_url: String,
    pub bridge_token: String,
    pub cancellation: CancellationToken,
    pub channel: tauri::ipc::Channel<LocalAgentEvent>,
    pub cli_version: String,
}

pub struct ProtocolOutcome {
    pub session_id: Option<String>,
    pub aborted: bool,
}

pub fn claude_isolation_error() -> String {
    CLAUDE_ISOLATION_ERROR.to_string()
}

struct SpawnedProcess {
    child: Arc<tokio::sync::Mutex<Box<dyn ChildWrapper>>>,
    stdin: ChildStdin,
    stdout: ChildStdout,
    stderr: ChildStderr,
    tree_guard: ProcessTreeGuard,
}

struct ProcessTreeGuard {
    #[cfg(unix)]
    pgid: i32,
    armed: bool,
}

impl ProcessTreeGuard {
    fn new(child: &dyn ChildWrapper) -> Result<Self, String> {
        #[cfg(unix)]
        let pgid = child
            .id()
            .and_then(|id| i32::try_from(id).ok())
            .ok_or_else(|| "failed to identify local CLI process group".to_string())?;
        #[cfg(not(unix))]
        let _ = child;

        Ok(Self {
            #[cfg(unix)]
            pgid,
            armed: true,
        })
    }

    fn cleanup(&mut self) {
        if !self.armed {
            return;
        }
        #[cfg(unix)]
        unsafe {
            // Reap descendants that can outlive a normally exited leader.
            let _ = libc::kill(-self.pgid, libc::SIGKILL);
        }
        self.armed = false;
    }
}

impl Drop for ProcessTreeGuard {
    fn drop(&mut self) {
        self.cleanup();
        // On Windows, closing the process-wrap Job Object is the ownership
        // boundary and terminates every process assigned to it.
    }
}

#[derive(Default)]
struct ProtocolOutputBudget {
    bytes: usize,
    events: usize,
}

impl ProtocolOutputBudget {
    fn record(&mut self, line: &str) -> Result<(), String> {
        self.bytes = self
            .bytes
            .checked_add(line.len().saturating_add(1))
            .ok_or_else(|| "local CLI output byte counter overflowed".to_string())?;
        self.events = self
            .events
            .checked_add(1)
            .ok_or_else(|| "local CLI output event counter overflowed".to_string())?;
        if self.bytes > MAX_PROTOCOL_OUTPUT_BYTES {
            return Err("local CLI output exceeded the cumulative byte limit".to_string());
        }
        if self.events > MAX_PROTOCOL_EVENTS {
            return Err("local CLI output exceeded the event limit".to_string());
        }
        Ok(())
    }
}

fn spawn_stderr_drain(
    mut stderr: ChildStderr,
) -> (Arc<AtomicBool>, tauri::async_runtime::JoinHandle<()>) {
    let saw_stderr = Arc::new(AtomicBool::new(false));
    let stderr_flag = saw_stderr.clone();
    let task = tauri::async_runtime::spawn(async move {
        let mut buffer = [0_u8; 4096];
        let mut diagnostic_bytes = 0_usize;
        loop {
            match stderr.read(&mut buffer).await {
                Ok(0) | Err(_) => break,
                Ok(bytes) => {
                    stderr_flag.store(true, Ordering::Relaxed);
                    if diagnostic_bytes < MAX_DIAGNOSTIC_BYTES {
                        diagnostic_bytes = diagnostic_bytes
                            .saturating_add(bytes)
                            .min(MAX_DIAGNOSTIC_BYTES);
                    }
                    // Keep draining after the diagnostic budget is exhausted.
                    // Closing the pipe here can crash otherwise healthy CLIs
                    // with EPIPE while they are still completing the turn.
                }
            }
        }
    });
    (saw_stderr, task)
}

fn provider_error(context: &str, saw_stderr: bool) -> String {
    if saw_stderr {
        format!("{context}; CLI stderr was redacted")
    } else {
        context.to_string()
    }
}

pub fn apply_minimal_environment(command: &mut Command) {
    const ALLOWED_EXACT: &[&str] = &[
        "PATH",
        "HOME",
        "USER",
        "LOGNAME",
        "TMPDIR",
        "TMP",
        "TEMP",
        "LANG",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "HTTPS_PROXY",
        "HTTP_PROXY",
        "ALL_PROXY",
        "NO_PROXY",
        "https_proxy",
        "http_proxy",
        "all_proxy",
        "no_proxy",
        "XDG_CONFIG_HOME",
        "XDG_DATA_HOME",
        "APPDATA",
        "LOCALAPPDATA",
        "USERPROFILE",
        "HOMEDRIVE",
        "HOMEPATH",
        "SystemRoot",
        "CODEX_HOME",
        "CLAUDE_CONFIG_DIR",
    ];
    command.env_clear();
    for (name, value) in std::env::vars_os() {
        let name_text = name.to_string_lossy();
        if ALLOWED_EXACT.iter().any(|allowed| *allowed == name_text) || name_text.starts_with("LC_")
        {
            command.env(name, value);
        }
    }
    let loopback_hosts = "127.0.0.1,localhost,::1";
    let inherited_no_proxy = std::env::var("NO_PROXY")
        .or_else(|_| std::env::var("no_proxy"))
        .unwrap_or_default();
    let no_proxy = if inherited_no_proxy.trim().is_empty() {
        loopback_hosts.to_string()
    } else {
        format!("{inherited_no_proxy},{loopback_hosts}")
    };
    command.env("NO_PROXY", &no_proxy).env("no_proxy", no_proxy);
}

pub fn codex_process_args() -> Vec<String> {
    [
        "-c",
        "model_provider=\"openai\"",
        "-c",
        "mcp_servers={}",
        "-c",
        "notify=[]",
        "-c",
        "analytics.enabled=false",
        "-c",
        "otel.exporter=\"none\"",
        "-c",
        "otel.trace_exporter=\"none\"",
        "-c",
        "otel.metrics_exporter=\"none\"",
        "-c",
        "otel.log_user_prompt=false",
        "-c",
        "instructions=\"\"",
        "-c",
        "developer_instructions=\"\"",
        "-c",
        "include_permissions_instructions=false",
        "-c",
        "include_apps_instructions=false",
        "-c",
        "include_collaboration_mode_instructions=false",
        "-c",
        "include_environment_context=false",
        "-c",
        "features.shell_tool=false",
        "-c",
        "features.unified_exec=false",
        "-c",
        "features.hooks=false",
        "-c",
        "features.multi_agent=false",
        "-c",
        "features.multi_agent_v2=false",
        "-c",
        "features.apps=false",
        "-c",
        "features.plugins=false",
        "-c",
        "features.browser_use=false",
        "-c",
        "features.browser_use_external=false",
        "-c",
        "features.browser_use_full_cdp_access=false",
        "-c",
        "features.computer_use=false",
        "-c",
        "features.image_generation=false",
        "-c",
        "features.in_app_browser=false",
        "-c",
        "features.js_repl=false",
        "-c",
        "features.skill_search=false",
        "-c",
        "features.skill_mcp_dependency_install=false",
        "-c",
        "features.workspace_dependencies=false",
        "-c",
        "features.view_image=false",
        "-c",
        "agents.enabled=false",
        "-c",
        "project_doc_max_bytes=0",
        "app-server",
        "--strict-config",
        "--stdio",
    ]
    .into_iter()
    .map(str::to_string)
    .collect()
}

#[allow(dead_code)] // Retained for a future CLI with a pre-input isolation handshake.
fn claude_process_args(
    context: &ProtocolContext,
    mcp_config: &Path,
    prompt_file: &Path,
) -> Vec<String> {
    let mut args = vec![
        "-p".to_string(),
        "--input-format".to_string(),
        "stream-json".to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--verbose".to_string(),
        "--include-partial-messages".to_string(),
        "--strict-mcp-config".to_string(),
        "--mcp-config".to_string(),
        mcp_config.to_string_lossy().to_string(),
        "--setting-sources".to_string(),
        "local".to_string(),
        "--disable-slash-commands".to_string(),
        "--no-chrome".to_string(),
        "--system-prompt-file".to_string(),
        prompt_file.to_string_lossy().to_string(),
        "--permission-mode".to_string(),
        "dontAsk".to_string(),
        "--allowedTools".to_string(),
        if context.request.native_search {
            "mcp__open_builder__*,WebSearch,WebFetch".to_string()
        } else {
            "mcp__open_builder__*".to_string()
        },
        "--tools".to_string(),
        if context.request.native_search {
            "WebSearch,WebFetch".to_string()
        } else {
            String::new()
        },
    ];
    if let Some(model) = context
        .request
        .model
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        args.extend(["--model".to_string(), model.to_string()]);
    }
    if let Some(effort) = context
        .request
        .effort
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        args.extend(["--effort".to_string(), effort.to_string()]);
    }
    if let Some(session_id) = context
        .request
        .session_id
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        args.extend(["--resume".to_string(), session_id.to_string()]);
    }
    args
}

fn spawn_wrapped(mut command: Command) -> Result<SpawnedProcess, String> {
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut wrapped = CommandWrap::from(command);
    wrapped.wrap(KillOnDrop);
    #[cfg(unix)]
    wrapped.wrap(ProcessGroup::leader());
    #[cfg(windows)]
    wrapped.wrap(JobObject);
    let mut child = wrapped
        .spawn()
        .map_err(|_| "failed to start local CLI".to_string())?;
    let tree_guard = ProcessTreeGuard::new(child.as_ref())?;
    let stdin = child
        .stdin()
        .take()
        .ok_or_else(|| "failed to open local CLI stdin".to_string())?;
    let stdout = child
        .stdout()
        .take()
        .ok_or_else(|| "failed to open local CLI stdout".to_string())?;
    let stderr = child
        .stderr()
        .take()
        .ok_or_else(|| "failed to open local CLI stderr".to_string())?;
    Ok(SpawnedProcess {
        child: Arc::new(tokio::sync::Mutex::new(child)),
        stdin,
        stdout,
        stderr,
        tree_guard,
    })
}

async fn read_capped_output<Stdout, Stderr>(
    stdout: &mut Stdout,
    stderr: &mut Stderr,
    max_output_bytes: usize,
) -> Result<(Vec<u8>, Vec<u8>), String>
where
    Stdout: AsyncRead + Unpin,
    Stderr: AsyncRead + Unpin,
{
    let mut stdout_bytes = Vec::new();
    let mut stderr_bytes = Vec::new();
    let mut stdout_open = true;
    let mut stderr_open = true;
    let mut stdout_buffer = [0_u8; 4096];
    let mut stderr_buffer = [0_u8; 4096];

    while stdout_open || stderr_open {
        let current_total = stdout_bytes.len().saturating_add(stderr_bytes.len());
        tokio::select! {
            result = stdout.read(&mut stdout_buffer), if stdout_open => {
                let bytes = result.map_err(|_| "failed to read local CLI capability probe".to_string())?;
                if bytes == 0 {
                    stdout_open = false;
                    continue;
                }
                if current_total.saturating_add(bytes) > max_output_bytes {
                    return Err("local CLI capability probe exceeded the output limit".to_string());
                }
                stdout_bytes.extend_from_slice(&stdout_buffer[..bytes]);
            }
            result = stderr.read(&mut stderr_buffer), if stderr_open => {
                let bytes = result.map_err(|_| "failed to read local CLI capability probe".to_string())?;
                if bytes == 0 {
                    stderr_open = false;
                    continue;
                }
                if current_total.saturating_add(bytes) > max_output_bytes {
                    return Err("local CLI capability probe exceeded the output limit".to_string());
                }
                stderr_bytes.extend_from_slice(&stderr_buffer[..bytes]);
            }
        }
    }

    Ok((stdout_bytes, stderr_bytes))
}

pub async fn command_output_capped(
    executable: &Path,
    args: &[&str],
    timeout: Duration,
    max_output_bytes: usize,
) -> Result<std::process::Output, String> {
    let mut command = Command::new(executable);
    apply_minimal_environment(&mut command);
    command.args(args);
    let process = spawn_wrapped(command)?;
    let child = process.child.clone();
    let mut stdout = process.stdout;
    let mut stderr = process.stderr;
    let mut tree_guard = process.tree_guard;
    drop(process.stdin);

    let capture = async {
        let (stdout, stderr) =
            read_capped_output(&mut stdout, &mut stderr, max_output_bytes).await?;
        let status = child
            .lock()
            .await
            .wait()
            .await
            .map_err(|_| "failed to wait for local CLI capability probe".to_string())?;
        Ok::<_, String>(std::process::Output {
            status,
            stdout,
            stderr,
        })
    };

    match tokio::time::timeout(timeout, capture).await {
        Ok(Ok(output)) => {
            tree_guard.cleanup();
            Ok(output)
        }
        Ok(Err(error)) => {
            if terminate(&child).await {
                tree_guard.cleanup();
            }
            Err(error)
        }
        Err(_) => {
            if terminate(&child).await {
                tree_guard.cleanup();
            }
            Err("local CLI capability probe timed out".to_string())
        }
    }
}

async fn terminate(child: &Arc<tokio::sync::Mutex<Box<dyn ChildWrapper>>>) -> bool {
    let mut child = child.lock().await;
    let _ = child.start_kill();
    matches!(
        tokio::time::timeout(SHUTDOWN_TIMEOUT, child.wait()).await,
        Ok(Ok(_))
    )
}

async fn finish_process(
    child: Arc<tokio::sync::Mutex<Box<dyn ChildWrapper>>>,
    stderr_task: tauri::async_runtime::JoinHandle<()>,
    mut tree_guard: ProcessTreeGuard,
) -> Result<Option<std::process::ExitStatus>, String> {
    let waited = {
        let mut child = child.lock().await;
        tokio::time::timeout(SHUTDOWN_TIMEOUT, child.wait()).await
    };
    let result = match waited {
        Ok(Ok(status)) => {
            tree_guard.cleanup();
            Ok(Some(status))
        }
        Ok(Err(_)) => {
            if terminate(&child).await {
                tree_guard.cleanup();
            }
            Err("failed to wait for local CLI process".to_string())
        }
        Err(_) => {
            if terminate(&child).await {
                tree_guard.cleanup();
            }
            Ok(None)
        }
    };
    stderr_task.abort();
    result
}

async fn read_capped_line<R: AsyncBufRead + Unpin>(
    reader: &mut R,
) -> Result<Option<String>, String> {
    let mut bytes = Vec::new();
    loop {
        let available = reader
            .fill_buf()
            .await
            .map_err(|_| "failed to read local CLI output".to_string())?;
        if available.is_empty() {
            return if bytes.is_empty() {
                Ok(None)
            } else {
                String::from_utf8(bytes)
                    .map(Some)
                    .map_err(|_| "local CLI emitted invalid UTF-8".to_string())
            };
        }
        let consumed = available
            .iter()
            .position(|byte| *byte == b'\n')
            .map(|index| index + 1)
            .unwrap_or(available.len());
        if bytes.len().saturating_add(consumed) > MAX_JSON_LINE_BYTES {
            return Err("local CLI JSON event exceeded the line limit".to_string());
        }
        bytes.extend_from_slice(&available[..consumed]);
        reader.consume(consumed);
        if bytes.last() == Some(&b'\n') {
            bytes.pop();
            if bytes.last() == Some(&b'\r') {
                bytes.pop();
            }
            return String::from_utf8(bytes)
                .map(Some)
                .map_err(|_| "local CLI emitted invalid UTF-8".to_string());
        }
    }
}

async fn write_json(stdin: &mut ChildStdin, value: &Value) -> Result<(), String> {
    let mut bytes = serde_json::to_vec(value)
        .map_err(|_| "failed to serialize local CLI request".to_string())?;
    if bytes.len() > MAX_JSON_LINE_BYTES {
        return Err("local CLI request exceeded the line limit".to_string());
    }
    bytes.push(b'\n');
    stdin
        .write_all(&bytes)
        .await
        .map_err(|_| "failed to write local CLI request".to_string())?;
    stdin
        .flush()
        .await
        .map_err(|_| "failed to flush local CLI request".to_string())
}

struct CodexIo {
    stdin: ChildStdin,
    reader: BufReader<ChildStdout>,
    next_id: u64,
    cancellation: CancellationToken,
    output_budget: ProtocolOutputBudget,
}

impl CodexIo {
    async fn read_value(&mut self) -> Result<Value, String> {
        let line = tokio::select! {
            _ = self.cancellation.cancelled() => return Err("local agent run cancelled".to_string()),
            line = read_capped_line(&mut self.reader) => line?,
        }
        .ok_or_else(|| "Codex App Server closed unexpectedly".to_string())?;
        self.output_budget.record(&line)?;
        serde_json::from_str(&line)
            .map_err(|_| "Codex App Server emitted malformed JSON".to_string())
    }

    async fn notify(&mut self, method: &str, params: Value) -> Result<(), String> {
        write_json(
            &mut self.stdin,
            &json!({"jsonrpc":"2.0","method":method,"params":params}),
        )
        .await
    }

    async fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;
        write_json(
            &mut self.stdin,
            &json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}),
        )
        .await?;
        loop {
            let message = self.read_value().await?;
            if message.get("id").and_then(Value::as_u64) == Some(id) {
                if let Some(error) = message.get("error") {
                    let summary = error
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("Codex App Server request failed");
                    return Err(summary.to_string());
                }
                return Ok(message.get("result").cloned().unwrap_or(Value::Null));
            }
            if message.get("id").is_some() && message.get("method").is_some() {
                let request_id = message.get("id").cloned().unwrap_or(Value::Null);
                write_json(
                    &mut self.stdin,
                    &json!({
                        "jsonrpc":"2.0",
                        "id":request_id,
                        "error":{"code":-32601,"message":"Open Builder denies unexpected native requests"}
                    }),
                )
                .await?;
                return Err("Codex requested an unexpected native capability".to_string());
            }
        }
    }

    async fn request_without_waiting(&mut self, method: &str, params: Value) -> Result<(), String> {
        let id = self.next_id;
        self.next_id += 1;
        write_json(
            &mut self.stdin,
            &json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}),
        )
        .await
    }
}

async fn initialize_codex(io: &mut CodexIo) -> Result<(), String> {
    io.request(
        "initialize",
        json!({
            "clientInfo": {
                "name": "open-builder",
                "title": "Open Builder",
                "version": env!("CARGO_PKG_VERSION")
            },
            "capabilities": {"experimentalApi": false}
        }),
    )
    .await?;
    io.notify("initialized", json!({})).await
}

fn is_official_codex_endpoint(value: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(value) else {
        return false;
    };
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    host == "openai.com"
        || host.ends_with(".openai.com")
        || host == "chatgpt.com"
        || host.ends_with(".chatgpt.com")
}

async fn validate_codex_effective_config(io: &mut CodexIo) -> Result<(), String> {
    let response = io
        .request("config/read", json!({"includeLayers": false}))
        .await?;
    let config = response
        .get("config")
        .and_then(Value::as_object)
        .ok_or_else(|| "Codex did not return a verifiable effective configuration".to_string())?;

    if config.get("model_provider").and_then(Value::as_str) != Some("openai") {
        return Err("Codex model provider isolation check failed".to_string());
    }
    for key in ["openai_base_url", "chatgpt_base_url"] {
        if let Some(value) = config
            .get(key)
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
        {
            if !is_official_codex_endpoint(value) {
                return Err(format!("Codex {key} is not an official provider endpoint"));
            }
        }
    }
    if config
        .get("model_instructions_file")
        .and_then(Value::as_str)
        .is_some_and(|path| !path.is_empty())
    {
        return Err("Codex loaded an external model instructions file".to_string());
    }

    let features = config
        .get("features")
        .and_then(Value::as_object)
        .ok_or_else(|| "Codex did not report its effective feature configuration".to_string())?;
    for feature in [
        "shell_tool",
        "unified_exec",
        "hooks",
        "multi_agent",
        "multi_agent_v2",
        "apps",
        "plugins",
        "browser_use",
        "browser_use_external",
        "browser_use_full_cdp_access",
        "computer_use",
        "image_generation",
        "in_app_browser",
        "skill_search",
        "skill_mcp_dependency_install",
        "workspace_dependencies",
        "view_image",
    ] {
        if features.get(feature).and_then(Value::as_bool) != Some(false) {
            return Err(format!("Codex feature {feature} is not disabled"));
        }
    }
    if config
        .get("agents")
        .and_then(Value::as_object)
        .and_then(|agents| agents.get("enabled"))
        .and_then(Value::as_bool)
        != Some(false)
    {
        return Err("Codex native agents are not disabled".to_string());
    }
    if config
        .get("mcp_servers")
        .and_then(Value::as_object)
        .is_none_or(|servers| !servers.is_empty())
    {
        return Err("Codex loaded external MCP configuration".to_string());
    }
    Ok(())
}

pub async fn probe_codex_app_server(
    executable: &Path,
) -> Result<(bool, Vec<LocalAgentModel>), String> {
    let mut command = Command::new(executable);
    apply_minimal_environment(&mut command);
    command.args(codex_process_args());
    let process = spawn_wrapped(command)?;
    let (saw_stderr, stderr_task) = spawn_stderr_drain(process.stderr);
    let child = process.child.clone();
    let mut tree_guard = process.tree_guard;
    let mut io = CodexIo {
        stdin: process.stdin,
        reader: BufReader::new(process.stdout),
        next_id: 1,
        cancellation: CancellationToken::new(),
        output_budget: ProtocolOutputBudget::default(),
    };
    let result = async {
        initialize_codex(&mut io).await?;
        validate_codex_effective_config(&mut io).await?;
        let account = io
            .request("account/read", json!({"refreshToken": false}))
            .await?;
        let models = io
            .request("model/list", json!({"limit": 100, "includeHidden": false}))
            .await?;
        let signed_in = account.get("account").is_some_and(|value| !value.is_null())
            || !account
                .get("requiresOpenaiAuth")
                .and_then(Value::as_bool)
                .unwrap_or(true);
        let models = models
            .get("data")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|model| {
                if model
                    .get("hidden")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
                {
                    return None;
                }
                Some(LocalAgentModel {
                    id: model
                        .get("id")
                        .or_else(|| model.get("model"))?
                        .as_str()?
                        .to_string(),
                    display_name: model
                        .get("displayName")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    is_default: model
                        .get("isDefault")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                    default_effort: model
                        .get("defaultReasoningEffort")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    efforts: model
                        .get("supportedReasoningEfforts")
                        .and_then(Value::as_array)
                        .into_iter()
                        .flatten()
                        .filter_map(|entry| {
                            entry
                                .get("reasoningEffort")
                                .or_else(|| entry.get("effort"))
                                .and_then(Value::as_str)
                                .map(str::to_string)
                        })
                        .collect(),
                })
            })
            .collect();
        Ok((signed_in, models))
    }
    .await;
    if terminate(&child).await {
        tree_guard.cleanup();
    }
    stderr_task.abort();
    result.map_err(|error: String| provider_error(&error, saw_stderr.load(Ordering::Relaxed)))
}

pub async fn run(context: ProtocolContext) -> Result<ProtocolOutcome, String> {
    match context.request.provider {
        LocalAgentProvider::Codex => run_codex(context).await,
        LocalAgentProvider::Claude => Err(claude_isolation_error()),
    }
}

fn codex_thread_config(context: &ProtocolContext) -> Value {
    json!({
        "mcp_servers": {
            "open_builder": {
                "url": context.bridge_url,
                "bearer_token_env_var": CODEX_MCP_TOKEN_ENV,
                "required": true
            }
        },
        "notify": [],
        "instructions": "",
        "developer_instructions": "",
        "include_permissions_instructions": false,
        "include_apps_instructions": false,
        "include_collaboration_mode_instructions": false,
        "include_skill_instructions": false,
        "include_environment_context": false,
        "features": {
            "shell_tool": false,
            "unified_exec": false,
            "hooks": false,
            "multi_agent": false,
            "multi_agent_v2": false,
            "apps": false,
            "plugins": false,
            "browser_use": false,
            "browser_use_external": false,
            "browser_use_full_cdp_access": false,
            "computer_use": false,
            "image_generation": false,
            "in_app_browser": false,
            "js_repl": false,
            "skill_search": false,
            "skill_mcp_dependency_install": false,
            "workspace_dependencies": false,
            "view_image": false
        },
        "agents": {"enabled": false},
        "tools": {"view_image": false},
        "project_doc_max_bytes": 0,
        "web_search": if context.request.native_search { "live" } else { "disabled" }
    })
}

fn turn_prompt(request: &LocalAgentStartRequest) -> String {
    match request
        .bootstrap_context
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        Some(bootstrap) => format!(
            "[Open Builder application history]\n{bootstrap}\n\n[Current request]\n{}",
            request.prompt
        ),
        None => request.prompt.clone(),
    }
}

async fn run_codex(context: ProtocolContext) -> Result<ProtocolOutcome, String> {
    let mut command = Command::new(&context.executable);
    apply_minimal_environment(&mut command);
    command
        .args(codex_process_args())
        .current_dir(&context.run_dir)
        .env(CODEX_MCP_TOKEN_ENV, &context.bridge_token);
    let process = spawn_wrapped(command)?;
    let child = process.child.clone();
    let (saw_stderr, stderr_task) = spawn_stderr_drain(process.stderr);
    let tree_guard = process.tree_guard;
    let mut io = CodexIo {
        stdin: process.stdin,
        reader: BufReader::new(process.stdout),
        next_id: 1,
        cancellation: context.cancellation.clone(),
        output_budget: ProtocolOutputBudget::default(),
    };

    let run_result = async {
        let (thread_id, turn_id) = tokio::time::timeout(HANDSHAKE_TIMEOUT, async {
            initialize_codex(&mut io).await?;
            validate_codex_effective_config(&mut io).await?;
            let common = json!({
                "approvalPolicy": "never",
                "cwd": context.run_dir,
                "developerInstructions": context.request.system_prompt,
                "model": context.request.model,
                "sandbox": "read-only",
                "runtimeWorkspaceRoots": [],
                "config": codex_thread_config(&context)
            });
            let thread_response = if let Some(session_id) = context.request.session_id.as_deref() {
                let mut params = common.as_object().cloned().unwrap_or_default();
                params.insert("threadId".to_string(), json!(session_id));
                io.request("thread/resume", Value::Object(params)).await?
            } else {
                io.request("thread/start", common).await?
            };
            let thread_id = thread_response
                .pointer("/thread/id")
                .and_then(Value::as_str)
                .ok_or_else(|| "Codex App Server did not return a thread id".to_string())?
                .to_string();
            let instruction_sources = thread_response
                .get("instructionSources")
                .or_else(|| thread_response.pointer("/thread/instructionSources"));
            if instruction_sources
                .and_then(Value::as_array)
                .is_some_and(|sources| !sources.is_empty())
            {
                return Err(
                    "Codex loaded external instruction files despite isolation".to_string(),
                );
            }
            let mcp_status = io
                .request(
                    "mcpServerStatus/list",
                    json!({"threadId": thread_id, "limit": 100}),
                )
                .await?;
            let entries = mcp_status
                .get("data")
                .and_then(Value::as_array)
                .ok_or_else(|| {
                    "Codex did not return a verifiable MCP server inventory".to_string()
                })?;
            let names = entries
                .iter()
                .filter_map(|entry| entry.get("name").and_then(Value::as_str))
                .collect::<Vec<_>>();
            if names.len() != 1
                || !matches!(names.first().copied(), Some("open_builder" | "open-builder"))
            {
                return Err("Codex MCP isolation check failed".to_string());
            }
            if entries.iter().any(|entry| {
                entry.get("status").and_then(Value::as_str) == Some("failed")
            }) {
                return Err("Open Builder MCP bridge failed to start in Codex".to_string());
            }
            context
                .channel
                .send(LocalAgentEvent::Session {
                    session_id: thread_id.clone(),
                    cli_version: context.cli_version.clone(),
                })
                .map_err(|_| "local agent event consumer is unavailable".to_string())?;
            let turn_response = io
                .request(
                    "turn/start",
                    json!({
                        "threadId": thread_id,
                        "input": [{"type":"text","text":turn_prompt(&context.request)}],
                        "model": context.request.model,
                        "effort": context.request.effort,
                        "approvalPolicy": "never",
                        "sandboxPolicy": {"type":"readOnly","networkAccess":false},
                        "runtimeWorkspaceRoots": [],
                        "environments": []
                    }),
                )
                .await?;
            let turn_id = turn_response
                .pointer("/turn/id")
                .and_then(Value::as_str)
                .ok_or_else(|| "Codex App Server did not return a turn id".to_string())?
                .to_string();
            context
                .channel
                .send(LocalAgentEvent::Status {
                    state: "streaming".to_string(),
                    message: None,
                })
                .map_err(|_| "local agent event consumer is unavailable".to_string())?;
            Ok::<_, String>((thread_id, turn_id))
        })
        .await
        .map_err(|_| "Codex App Server handshake timed out".to_string())??;

        loop {
            let message = match io.read_value().await {
                Ok(message) => message,
                Err(_error) if context.cancellation.is_cancelled() => {
                    let _ = io
                        .request_without_waiting(
                            "turn/interrupt",
                            json!({"threadId":thread_id,"turnId":turn_id}),
                        )
                        .await;
                    return Ok(ProtocolOutcome {
                        session_id: Some(thread_id),
                        aborted: true,
                    });
                }
                Err(error) => return Err(error),
            };
            if message.get("id").is_some() && message.get("method").is_some() {
                let request_id = message.get("id").cloned().unwrap_or(Value::Null);
                write_json(
                    &mut io.stdin,
                    &json!({
                        "jsonrpc":"2.0",
                        "id":request_id,
                        "error":{"code":-32601,"message":"Open Builder denies unexpected native requests"}
                    }),
                )
                .await?;
                return Err("Codex requested an unexpected native capability".to_string());
            }
            let Some(method) = message.get("method").and_then(Value::as_str) else {
                continue;
            };
            let params = message.get("params").cloned().unwrap_or(Value::Null);
            match method {
                "item/agentMessage/delta" => {
                    if let Some(delta) = params.get("delta").and_then(Value::as_str) {
                        context
                            .channel
                            .send(LocalAgentEvent::TextDelta {
                                delta: delta.to_string(),
                            })
                            .map_err(|_| "local agent event consumer is unavailable".to_string())?;
                    }
                }
                "item/reasoning/summaryTextDelta" | "item/reasoning/textDelta" => {
                    if let Some(delta) = params.get("delta").and_then(Value::as_str) {
                        context
                            .channel
                            .send(LocalAgentEvent::ReasoningDelta {
                                delta: delta.to_string(),
                            })
                            .map_err(|_| "local agent event consumer is unavailable".to_string())?;
                    }
                }
                "item/started" | "item/completed" => {
                    if let Some(item) = params.get("item") {
                        let item_type = item.get("type").and_then(Value::as_str).unwrap_or("");
                        match item_type {
                            "webSearch" if context.request.native_search => {
                                context
                                    .channel
                                    .send(LocalAgentEvent::NativeTool {
                                        call_id: item
                                            .get("id")
                                            .and_then(Value::as_str)
                                            .unwrap_or("codex-web-search")
                                            .to_string(),
                                        name: "web_search".to_string(),
                                        phase: if method == "item/started" {
                                            "started".to_string()
                                        } else {
                                            "completed".to_string()
                                        },
                                        arguments: item.get("query").cloned().map(|query| json!({"query":query})),
                                        result: if method == "item/completed" {
                                            item.get("results").cloned()
                                        } else {
                                            None
                                        },
                                    })
                                    .map_err(|_| "local agent event consumer is unavailable".to_string())?;
                            }
                            "webSearch" => {
                                return Err(
                                    "Codex attempted to use disabled native web search"
                                        .to_string(),
                                );
                            }
                            "mcpToolCall" => {
                                let server = item.get("server").and_then(Value::as_str).unwrap_or("");
                                if server != "open_builder" && server != "open-builder" {
                                    return Err("Codex attempted to use an external MCP server".to_string());
                                }
                            }
                            "commandExecution"
                            | "fileChange"
                            | "dynamicToolCall"
                            | "collabAgentToolCall"
                            | "hookPrompt"
                            | "imageView"
                            | "imageGeneration"
                            | "sleep"
                            | "subAgentActivity"
                            | "enteredReviewMode"
                            | "exitedReviewMode" => {
                                return Err(format!(
                                    "Codex attempted to use disabled native capability {item_type}"
                                ));
                            }
                            "userMessage"
                            | "agentMessage"
                            | "plan"
                            | "reasoning"
                            | "contextCompaction" => {}
                            "" => {
                                return Err("Codex emitted a malformed thread item".to_string())
                            }
                            _ => {
                                return Err(format!(
                                    "Codex emitted an unsupported thread item {item_type}"
                                ));
                            }
                        }
                    }
                }
                "thread/tokenUsage/updated" => {
                    let usage = params.pointer("/tokenUsage/last").unwrap_or(&Value::Null);
                    context
                        .channel
                        .send(LocalAgentEvent::Usage {
                            input_tokens: usage.get("inputTokens").and_then(Value::as_u64),
                            output_tokens: usage.get("outputTokens").and_then(Value::as_u64),
                            cached_input_tokens: usage
                                .get("cachedInputTokens")
                                .and_then(Value::as_u64),
                        })
                        .map_err(|_| "local agent event consumer is unavailable".to_string())?;
                }
                "error" => {
                    let will_retry = params
                        .get("willRetry")
                        .and_then(Value::as_bool)
                        .unwrap_or(false);
                    let message = params
                        .pointer("/error/message")
                        .and_then(Value::as_str)
                        .unwrap_or("Codex turn failed")
                        .to_string();
                    if will_retry {
                        context
                            .channel
                            .send(LocalAgentEvent::Warning { message })
                            .map_err(|_| "local agent event consumer is unavailable".to_string())?;
                    } else {
                        return Err(message);
                    }
                }
                "mcpServer/startupStatus/updated" => {
                    let name = params.get("name").and_then(Value::as_str).unwrap_or("");
                    if name != "open_builder" && name != "open-builder" {
                        return Err("Codex started an external MCP server".to_string());
                    }
                    if params.get("status").and_then(Value::as_str) == Some("failed") {
                        return Err("Open Builder MCP bridge failed to start in Codex".to_string());
                    }
                }
                "turn/completed" => {
                    let status = params
                        .pointer("/turn/status")
                        .and_then(Value::as_str)
                        .unwrap_or("failed");
                    if status == "completed" {
                        return Ok(ProtocolOutcome {
                            session_id: Some(thread_id),
                            aborted: false,
                        });
                    }
                    if status == "interrupted" {
                        return Ok(ProtocolOutcome {
                            session_id: Some(thread_id),
                            aborted: true,
                        });
                    }
                    return Err(params
                        .pointer("/turn/error/message")
                        .and_then(Value::as_str)
                        .unwrap_or("Codex turn failed")
                        .to_string());
                }
                _ => {}
            }
        }
    }
    .await;

    drop(io.stdin);
    let process_result = finish_process(child, stderr_task, tree_guard).await;
    let outcome =
        run_result.map_err(|error| provider_error(&error, saw_stderr.load(Ordering::Relaxed)))?;
    let status = process_result
        .map_err(|error| provider_error(&error, saw_stderr.load(Ordering::Relaxed)))?;
    if !outcome.aborted && status.is_some_and(|status| !status.success()) {
        return Err(provider_error(
            "Codex App Server exited unsuccessfully",
            saw_stderr.load(Ordering::Relaxed),
        ));
    }
    Ok(outcome)
}

#[allow(dead_code)] // Retained with the disabled Claude adapter.
fn write_private_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    std::fs::write(path, bytes)
        .map_err(|_| "failed to write isolated CLI configuration".to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .map_err(|_| "failed to secure isolated CLI configuration".to_string())?;
    }
    Ok(())
}

fn validate_claude_init(value: &Value, request: &LocalAgentStartRequest) -> Result<(), String> {
    let tools = value
        .get("tools")
        .and_then(Value::as_array)
        .ok_or_else(|| "Claude init did not include a verifiable tool inventory".to_string())?;
    let actual = tools
        .iter()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect::<HashSet<_>>();
    if actual.len() != tools.len() {
        return Err("Claude init returned a malformed tool inventory".to_string());
    }
    let mut expected = request
        .tools
        .iter()
        .map(|tool| format!("mcp__open_builder__{}", tool.name))
        .collect::<HashSet<_>>();
    if request.native_search {
        expected.insert("WebSearch".to_string());
        expected.insert("WebFetch".to_string());
    }
    if actual != expected {
        let unexpected = actual.difference(&expected).cloned().collect::<Vec<_>>();
        let missing = expected.difference(&actual).cloned().collect::<Vec<_>>();
        return Err(format!(
            "Claude tool isolation check failed (unexpected: {}; missing: {})",
            unexpected.join(", "),
            missing.join(", ")
        ));
    }

    for key in ["hooks", "plugins"] {
        if value.get(key).is_some_and(|entry| match entry {
            Value::Null => false,
            Value::Array(entries) => !entries.is_empty(),
            Value::Object(entries) => !entries.is_empty(),
            _ => true,
        }) {
            return Err(format!("Claude loaded unexpected {key} configuration"));
        }
    }

    if let Some(servers) = value.get("mcp_servers").and_then(Value::as_array) {
        let names = servers
            .iter()
            .filter_map(|server| {
                server
                    .get("name")
                    .and_then(Value::as_str)
                    .or_else(|| server.as_str())
            })
            .collect::<Vec<_>>();
        if names.iter().any(|name| *name != "open_builder") {
            return Err("Claude loaded an external MCP server".to_string());
        }
    }
    Ok(())
}

#[allow(dead_code)] // Guarded by run() until Claude can attest before input.
async fn run_claude(context: ProtocolContext) -> Result<ProtocolOutcome, String> {
    let mcp_config_path = context.run_dir.join("mcp.json");
    let prompt_path = context.run_dir.join("system-prompt.txt");
    let mcp_config = json!({
        "mcpServers": {
            "open_builder": {
                "type": "http",
                "url": context.bridge_url,
                "headers": {"Authorization": format!("Bearer {}", context.bridge_token)}
            }
        }
    });
    write_private_file(
        &mcp_config_path,
        &serde_json::to_vec(&mcp_config)
            .map_err(|_| "failed to serialize isolated MCP configuration".to_string())?,
    )?;
    write_private_file(&prompt_path, context.request.system_prompt.as_bytes())?;

    let mut command = Command::new(&context.executable);
    apply_minimal_environment(&mut command);
    command
        .args(claude_process_args(
            &context,
            &mcp_config_path,
            &prompt_path,
        ))
        .current_dir(&context.run_dir);
    let process = spawn_wrapped(command)?;
    let child = process.child.clone();
    let (saw_stderr, stderr_task) = spawn_stderr_drain(process.stderr);
    let tree_guard = process.tree_guard;
    let mut stdin = process.stdin;
    let mut reader = BufReader::new(process.stdout);
    write_json(
        &mut stdin,
        &json!({
            "type":"user",
            "message": {
                "role":"user",
                "content":[{"type":"text","text":turn_prompt(&context.request)}]
            }
        }),
    )
    .await?;
    drop(stdin);

    let mut session_id = context.request.session_id.clone();
    let mut emitted_text = false;
    let mut init_validated = false;
    let mut native_tools: HashMap<u64, (String, String, String)> = HashMap::new();
    let mut output_budget = ProtocolOutputBudget::default();
    let run_result = loop {
        let line = if init_validated {
            tokio::select! {
                _ = context.cancellation.cancelled() => {
                    break Ok(ProtocolOutcome { session_id, aborted: true });
                }
                line = read_capped_line(&mut reader) => line,
            }?
        } else {
            tokio::select! {
                _ = context.cancellation.cancelled() => {
                    break Ok(ProtocolOutcome { session_id, aborted: true });
                }
                line = tokio::time::timeout(HANDSHAKE_TIMEOUT, read_capped_line(&mut reader)) => {
                    line.map_err(|_| "Claude CLI handshake timed out".to_string())??
                }
            }
        };
        let Some(line) = line else {
            break Err("Claude CLI closed before returning a result".to_string());
        };
        output_budget.record(&line)?;
        let event: Value = serde_json::from_str(&line)
            .map_err(|_| "Claude CLI emitted malformed stream JSON".to_string())?;
        let is_init_event = event.get("type").and_then(Value::as_str) == Some("system")
            && event.get("subtype").and_then(Value::as_str) == Some("init");
        if !init_validated && !is_init_event {
            break Err("Claude CLI emitted output before its isolation handshake".to_string());
        }
        match event.get("type").and_then(Value::as_str).unwrap_or("") {
            "system" if event.get("subtype").and_then(Value::as_str) == Some("init") => {
                validate_claude_init(&event, &context.request)?;
                init_validated = true;
                if let Some(id) = event.get("session_id").and_then(Value::as_str) {
                    session_id = Some(id.to_string());
                    context
                        .channel
                        .send(LocalAgentEvent::Session {
                            session_id: id.to_string(),
                            cli_version: context.cli_version.clone(),
                        })
                        .map_err(|_| "local agent event consumer is unavailable".to_string())?;
                }
                context
                    .channel
                    .send(LocalAgentEvent::Status {
                        state: "streaming".to_string(),
                        message: None,
                    })
                    .map_err(|_| "local agent event consumer is unavailable".to_string())?;
            }
            "stream_event" => {
                let stream = event.get("event").unwrap_or(&Value::Null);
                match stream.get("type").and_then(Value::as_str).unwrap_or("") {
                    "content_block_start" => {
                        let index = stream.get("index").and_then(Value::as_u64).unwrap_or(0);
                        let block = stream.get("content_block").unwrap_or(&Value::Null);
                        if block.get("type").and_then(Value::as_str) == Some("tool_use") {
                            let name = block.get("name").and_then(Value::as_str).unwrap_or("");
                            let id = block
                                .get("id")
                                .and_then(Value::as_str)
                                .unwrap_or("claude-native-tool")
                                .to_string();
                            if matches!(name, "WebSearch" | "WebFetch")
                                && context.request.native_search
                            {
                                native_tools
                                    .insert(index, (id.clone(), name.to_string(), String::new()));
                                context
                                    .channel
                                    .send(LocalAgentEvent::NativeTool {
                                        call_id: id,
                                        name: name.to_string(),
                                        phase: "started".to_string(),
                                        arguments: None,
                                        result: None,
                                    })
                                    .map_err(|_| {
                                        "local agent event consumer is unavailable".to_string()
                                    })?;
                            } else if !name.starts_with("mcp__open_builder__") {
                                break Err(format!(
                                    "Claude attempted to use disabled native tool {name}"
                                ));
                            }
                        }
                    }
                    "content_block_delta" => {
                        let index = stream.get("index").and_then(Value::as_u64).unwrap_or(0);
                        let delta = stream.get("delta").unwrap_or(&Value::Null);
                        match delta.get("type").and_then(Value::as_str).unwrap_or("") {
                            "text_delta" => {
                                if let Some(text) = delta.get("text").and_then(Value::as_str) {
                                    emitted_text = true;
                                    context
                                        .channel
                                        .send(LocalAgentEvent::TextDelta {
                                            delta: text.to_string(),
                                        })
                                        .map_err(|_| {
                                            "local agent event consumer is unavailable".to_string()
                                        })?;
                                }
                            }
                            "thinking_delta" => {
                                if let Some(text) = delta.get("thinking").and_then(Value::as_str) {
                                    context
                                        .channel
                                        .send(LocalAgentEvent::ReasoningDelta {
                                            delta: text.to_string(),
                                        })
                                        .map_err(|_| {
                                            "local agent event consumer is unavailable".to_string()
                                        })?;
                                }
                            }
                            "input_json_delta" => {
                                if let Some((_, _, input)) = native_tools.get_mut(&index) {
                                    if let Some(partial) =
                                        delta.get("partial_json").and_then(Value::as_str)
                                    {
                                        input.push_str(partial);
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                    "content_block_stop" => {
                        let index = stream.get("index").and_then(Value::as_u64).unwrap_or(0);
                        if let Some((id, name, input)) = native_tools.remove(&index) {
                            context
                                .channel
                                .send(LocalAgentEvent::NativeTool {
                                    call_id: id,
                                    name,
                                    phase: "completed".to_string(),
                                    arguments: serde_json::from_str(&input).ok(),
                                    result: None,
                                })
                                .map_err(|_| {
                                    "local agent event consumer is unavailable".to_string()
                                })?;
                        }
                    }
                    _ => {}
                }
            }
            "result" => {
                if let Some(id) = event.get("session_id").and_then(Value::as_str) {
                    session_id = Some(id.to_string());
                }
                if !emitted_text {
                    if let Some(text) = event
                        .get("result")
                        .and_then(Value::as_str)
                        .filter(|text| !text.is_empty())
                    {
                        context
                            .channel
                            .send(LocalAgentEvent::TextDelta {
                                delta: text.to_string(),
                            })
                            .map_err(|_| "local agent event consumer is unavailable".to_string())?;
                    }
                }
                if let Some(usage) = event.get("usage") {
                    context
                        .channel
                        .send(LocalAgentEvent::Usage {
                            input_tokens: usage.get("input_tokens").and_then(Value::as_u64),
                            output_tokens: usage.get("output_tokens").and_then(Value::as_u64),
                            cached_input_tokens: usage
                                .get("cache_read_input_tokens")
                                .and_then(Value::as_u64),
                        })
                        .map_err(|_| "local agent event consumer is unavailable".to_string())?;
                }
                if event
                    .get("is_error")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
                {
                    break Err(event
                        .get("result")
                        .and_then(Value::as_str)
                        .unwrap_or("Claude CLI returned an error")
                        .to_string());
                }
                break Ok(ProtocolOutcome {
                    session_id,
                    aborted: false,
                });
            }
            _ => {}
        }
    };

    let process_result = finish_process(child, stderr_task, tree_guard).await;
    let outcome =
        run_result.map_err(|error| provider_error(&error, saw_stderr.load(Ordering::Relaxed)))?;
    let status = process_result
        .map_err(|error| provider_error(&error, saw_stderr.load(Ordering::Relaxed)))?;
    if !outcome.aborted && status.is_some_and(|status| !status.success()) {
        return Err(provider_error(
            "Claude CLI exited unsuccessfully",
            saw_stderr.load(Ordering::Relaxed),
        ));
    }
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn caps_combined_probe_output_while_streaming() {
        let (mut stdout_writer, mut stdout_reader) = tokio::io::duplex(MAX_JSON_LINE_BYTES);
        let (mut stderr_writer, mut stderr_reader) = tokio::io::duplex(MAX_JSON_LINE_BYTES);
        let stdout_task = tokio::spawn(async move {
            let _ = stdout_writer.write_all(&vec![b'o'; 192 * 1024]).await;
            let _ = stdout_writer.shutdown().await;
        });
        let stderr_task = tokio::spawn(async move {
            let _ = stderr_writer.write_all(&vec![b'e'; 192 * 1024]).await;
            let _ = stderr_writer.shutdown().await;
        });

        let result = read_capped_output(&mut stdout_reader, &mut stderr_reader, 256 * 1024).await;
        assert!(result
            .expect_err("combined output must be capped")
            .contains("output limit"));
        stdout_task.await.unwrap();
        stderr_task.await.unwrap();
    }

    #[tokio::test]
    async fn preserves_probe_stdout_and_stderr_below_budget() {
        let (mut stdout_writer, mut stdout_reader) = tokio::io::duplex(64);
        let (mut stderr_writer, mut stderr_reader) = tokio::io::duplex(64);
        stdout_writer.write_all(b"version\n").await.unwrap();
        stdout_writer.shutdown().await.unwrap();
        stderr_writer.write_all(b"warning\n").await.unwrap();
        stderr_writer.shutdown().await.unwrap();

        let (stdout, stderr) = read_capped_output(&mut stdout_reader, &mut stderr_reader, 64)
            .await
            .unwrap();
        assert_eq!(stdout, b"version\n");
        assert_eq!(stderr, b"warning\n");
    }

    #[test]
    fn claude_is_fail_closed_without_pre_input_attestation() {
        assert!(claude_isolation_error().contains("pre-input structured isolation handshake"));
    }

    #[tokio::test]
    async fn claude_run_rejects_before_executable_launch() {
        let outcome = run(ProtocolContext {
            executable: PathBuf::from("/definitely-missing-claude-executable"),
            request: LocalAgentStartRequest {
                provider: LocalAgentProvider::Claude,
                model: None,
                effort: None,
                system_prompt: "sensitive system prompt".to_string(),
                prompt: "sensitive user prompt".to_string(),
                bootstrap_context: None,
                session_id: None,
                tools: Vec::new(),
                max_tool_calls: 1,
                native_search: false,
                mode: "chat".to_string(),
            },
            run_dir: PathBuf::from("/definitely-missing-run-directory"),
            bridge_url: "http://127.0.0.1:1/mcp".to_string(),
            bridge_token: "unused".to_string(),
            cancellation: CancellationToken::new(),
            channel: tauri::ipc::Channel::new(|_| Ok(())),
            cli_version: "test".to_string(),
        })
        .await;
        let error = match outcome {
            Ok(_) => panic!("Claude must remain disabled without pre-input attestation"),
            Err(error) => error,
        };
        assert_eq!(error, claude_isolation_error());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn dropping_process_tree_guard_kills_spawned_descendants() {
        let marker = std::env::temp_dir().join(format!(
            "open-builder-process-tree-test-{}",
            uuid::Uuid::new_v4()
        ));
        let mut command = Command::new("/bin/sh");
        command
            .arg("-c")
            .arg("(sleep 0.5; touch \"$MARKER_PATH\") & echo ready; wait")
            .env("MARKER_PATH", &marker);
        let process = spawn_wrapped(command).expect("fixture process must spawn");
        let SpawnedProcess {
            child,
            stdin,
            stdout,
            stderr,
            tree_guard,
        } = process;
        let mut reader = BufReader::new(stdout);
        let mut ready = String::new();
        tokio::time::timeout(Duration::from_secs(2), reader.read_line(&mut ready))
            .await
            .expect("fixture must announce its descendant")
            .expect("fixture stdout must be readable");
        assert_eq!(ready.trim(), "ready");

        drop(tree_guard);
        drop(child);
        drop(stdin);
        drop(reader);
        drop(stderr);
        tokio::time::sleep(Duration::from_millis(900)).await;
        let descendant_survived = marker.exists();
        let _ = std::fs::remove_file(&marker);
        assert!(
            !descendant_survived,
            "descendant survived process-tree drop"
        );
    }

    #[test]
    fn codex_args_disable_native_execution() {
        let args = codex_process_args();
        assert!(args.contains(&"model_provider=\"openai\"".to_string()));
        assert!(args.contains(&"features.shell_tool=false".to_string()));
        assert!(args.contains(&"features.hooks=false".to_string()));
        assert!(!args.contains(&"include_skill_instructions=false".to_string()));
        assert!(!args.contains(&"tools.view_image=false".to_string()));
        assert!(args.ends_with(&[
            "app-server".to_string(),
            "--strict-config".to_string(),
            "--stdio".to_string()
        ]));
    }

    #[test]
    fn codex_endpoint_attestation_accepts_only_official_https_hosts() {
        assert!(is_official_codex_endpoint("https://api.openai.com/v1"));
        assert!(is_official_codex_endpoint(
            "https://chatgpt.com/backend-api/codex"
        ));
        assert!(!is_official_codex_endpoint("http://api.openai.com/v1"));
        assert!(!is_official_codex_endpoint(
            "https://openai.com.attacker.example/v1"
        ));
        assert!(!is_official_codex_endpoint(
            "https://user@api.openai.com/v1"
        ));
    }

    #[test]
    fn protocol_output_budget_is_cumulative() {
        let mut budget = ProtocolOutputBudget {
            bytes: MAX_PROTOCOL_OUTPUT_BYTES - 2,
            ..Default::default()
        };
        assert!(budget.record("x").is_ok());
        assert!(budget.record("x").is_err());

        let mut budget = ProtocolOutputBudget {
            events: MAX_PROTOCOL_EVENTS,
            ..Default::default()
        };
        assert!(budget.record("{}").is_err());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn successful_leader_exit_still_reaps_descendants() {
        let marker = std::env::temp_dir().join(format!(
            "open-builder-process-tree-normal-exit-{}",
            uuid::Uuid::new_v4()
        ));
        let script = format!(
            "(sleep 0.5; touch '{}') >/dev/null 2>&1 &",
            marker.display()
        );
        let output = command_output_capped(
            Path::new("/bin/sh"),
            &["-c", &script],
            Duration::from_secs(2),
            1024,
        )
        .await
        .expect("fixture leader must exit successfully");
        assert!(output.status.success());
        tokio::time::sleep(Duration::from_millis(900)).await;
        let descendant_survived = marker.exists();
        let _ = std::fs::remove_file(&marker);
        assert!(
            !descendant_survived,
            "descendant survived a normal leader exit"
        );
    }

    #[test]
    fn validates_claude_tool_inventory() {
        let mut request = LocalAgentStartRequest {
            provider: LocalAgentProvider::Claude,
            model: None,
            effort: None,
            system_prompt: "system".to_string(),
            prompt: "prompt".to_string(),
            bootstrap_context: None,
            session_id: None,
            tools: vec![crate::local_agent::LocalToolSpec {
                name: "read_files".to_string(),
                description: "Read files".to_string(),
                input_schema: json!({"type":"object"}),
            }],
            max_tool_calls: 32,
            native_search: false,
            mode: "chat".to_string(),
        };
        assert!(validate_claude_init(
            &json!({"tools":["mcp__open_builder__read_files"]}),
            &request
        )
        .is_ok());
        assert!(validate_claude_init(&json!({"tools":["Bash"]}), &request).is_err());
        request.native_search = true;
        assert!(validate_claude_init(
            &json!({"tools":[
                "mcp__open_builder__read_files",
                "WebSearch",
                "WebFetch"
            ]}),
            &request
        )
        .is_ok());
        assert!(validate_claude_init(&json!({"tools":["WebSearch"]}), &request).is_err());
    }
}
