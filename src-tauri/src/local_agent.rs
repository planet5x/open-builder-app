use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tokio_util::sync::CancellationToken;

use crate::local_agent_bridge::ToolBridge;
use crate::local_agent_protocol::{
    claude_isolation_error, command_output_capped, probe_codex_app_server, run as run_protocol,
    ProtocolContext,
};

const MAX_ACTIVE_RUNS: usize = 8;
const MAX_START_REQUEST_BYTES: usize = 4 * 1024 * 1024;
const MAX_TOOL_COUNT: usize = 128;
const MAX_TOOL_CALLS_PER_RUN: usize = 512;
const MAX_TOOL_NAME_BYTES: usize = 256;
const MAX_TOOL_DESCRIPTION_BYTES: usize = 128 * 1024;
const MAX_PATH_BYTES: usize = 4 * 1024;
const MAX_PROBE_OUTPUT_BYTES: usize = 256 * 1024;
const PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_RUN_DURATION: Duration = Duration::from_secs(30 * 60);
const RUN_CLEANUP_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LocalAgentProvider {
    Codex,
    Claude,
}

impl LocalAgentProvider {
    fn command_name(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::Claude => "claude",
        }
    }

    fn login_command(self) -> &'static str {
        match self {
            Self::Codex => "codex login",
            Self::Claude => "claude auth login",
        }
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LocalAgentAvailability {
    NotFound,
    Unsupported,
    SignedOut,
    Ready,
    Error,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAgentModel {
    pub id: String,
    pub display_name: String,
    pub is_default: bool,
    pub default_effort: Option<String>,
    pub efforts: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAgentProbe {
    provider: LocalAgentProvider,
    availability: LocalAgentAvailability,
    path: Option<String>,
    path_source: Option<String>,
    version: Option<String>,
    authenticated: bool,
    login_command: String,
    models: Vec<LocalAgentModel>,
    efforts: Vec<String>,
    capabilities: Vec<String>,
    message: Option<String>,
}

impl LocalAgentProbe {
    fn unavailable(
        provider: LocalAgentProvider,
        availability: LocalAgentAvailability,
        message: String,
    ) -> Self {
        Self {
            provider,
            availability,
            path: None,
            path_source: None,
            version: None,
            authenticated: false,
            login_command: provider.login_command().to_string(),
            models: Vec::new(),
            efforts: Vec::new(),
            capabilities: Vec::new(),
            message: Some(message),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalToolSpec {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAgentStartRequest {
    pub provider: LocalAgentProvider,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub system_prompt: String,
    pub prompt: String,
    pub bootstrap_context: Option<String>,
    pub session_id: Option<String>,
    pub tools: Vec<LocalToolSpec>,
    pub max_tool_calls: usize,
    pub native_search: bool,
    pub mode: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum LocalToolContent {
    Text {
        text: String,
    },
    Image {
        data: String,
        mime_type: String,
    },
    Audio {
        data: String,
        mime_type: String,
    },
    Resource {
        uri: String,
        mime_type: Option<String>,
        text: Option<String>,
        blob: Option<String>,
    },
    ResourceLink {
        uri: String,
        name: String,
        title: Option<String>,
        description: Option<String>,
        mime_type: Option<String>,
        size: Option<u64>,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalToolResolution {
    pub text: String,
    pub is_error: Option<bool>,
    pub structured_content: Option<serde_json::Value>,
    pub content: Option<Vec<LocalToolContent>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum LocalAgentEvent {
    Status {
        state: String,
        message: Option<String>,
    },
    Session {
        session_id: String,
        cli_version: String,
    },
    TextDelta {
        delta: String,
    },
    ReasoningDelta {
        delta: String,
    },
    ToolRequest {
        run_id: String,
        call_id: String,
        name: String,
        arguments: serde_json::Value,
    },
    NativeTool {
        call_id: String,
        name: String,
        phase: String,
        arguments: Option<serde_json::Value>,
        result: Option<serde_json::Value>,
    },
    Usage {
        input_tokens: Option<u64>,
        output_tokens: Option<u64>,
        cached_input_tokens: Option<u64>,
    },
    Warning {
        message: String,
    },
    Error {
        message: String,
        retryable: bool,
    },
    Done {
        aborted: bool,
        session_id: Option<String>,
    },
}

struct ActiveRun {
    cancellation: CancellationToken,
    task: Option<tauri::async_runtime::JoinHandle<()>>,
    run_dir: PathBuf,
}

pub struct LocalAgentState {
    runs: Arc<Mutex<HashMap<String, ActiveRun>>>,
    bridge: Arc<ToolBridge>,
}

impl Default for LocalAgentState {
    fn default() -> Self {
        Self {
            runs: Arc::new(Mutex::new(HashMap::new())),
            bridge: Arc::new(ToolBridge::default()),
        }
    }
}

impl LocalAgentState {
    pub async fn shutdown_gracefully(&self) {
        let active = self
            .runs
            .lock()
            .map(|mut runs| runs.drain().collect::<Vec<_>>())
            .unwrap_or_default();
        for (run_id, run) in &active {
            run.cancellation.cancel();
            self.bridge.unregister(run_id, "application exiting");
        }
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        for (_, mut run) in active {
            if let Some(mut task) = run.task.take() {
                if tokio::time::timeout_at(deadline, &mut task).await.is_err() {
                    task.abort();
                    let _ = task.await;
                }
            }
            let _ = std::fs::remove_dir_all(run.run_dir);
        }
        self.bridge.shutdown_now();
    }

    pub fn shutdown_now(&self) {
        if let Ok(mut runs) = self.runs.lock() {
            for (_, run) in runs.drain() {
                run.cancellation.cancel();
                if let Some(task) = run.task {
                    task.abort();
                }
                let _ = std::fs::remove_dir_all(run.run_dir);
            }
        }
        self.bridge.shutdown_now();
    }
}

impl Drop for LocalAgentState {
    fn drop(&mut self) {
        self.shutdown_now();
    }
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExecutableOverrides {
    codex: Option<String>,
    claude: Option<String>,
}

impl ExecutableOverrides {
    fn get(&self, provider: LocalAgentProvider) -> Option<&str> {
        match provider {
            LocalAgentProvider::Codex => self.codex.as_deref(),
            LocalAgentProvider::Claude => self.claude.as_deref(),
        }
    }

    fn set(&mut self, provider: LocalAgentProvider, path: Option<String>) {
        match provider {
            LocalAgentProvider::Codex => self.codex = path,
            LocalAgentProvider::Claude => self.claude = path,
        }
    }
}

fn overrides_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|_| "failed to resolve application config directory".to_string())?
        .join("local-agents.json"))
}

fn read_overrides(app: &AppHandle) -> ExecutableOverrides {
    let Ok(path) = overrides_path(app) else {
        return ExecutableOverrides::default();
    };
    let Ok(bytes) = std::fs::read(path) else {
        return ExecutableOverrides::default();
    };
    if bytes.len() > 16 * 1024 {
        return ExecutableOverrides::default();
    }
    serde_json::from_slice(&bytes).unwrap_or_default()
}

fn write_overrides(app: &AppHandle, overrides: &ExecutableOverrides) -> Result<(), String> {
    let path = overrides_path(app)?;
    let parent = path
        .parent()
        .ok_or_else(|| "invalid application config path".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|_| "failed to create application config directory".to_string())?;
    let bytes = serde_json::to_vec(overrides)
        .map_err(|_| "failed to serialize local CLI settings".to_string())?;
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, bytes)
        .map_err(|_| "failed to write local CLI settings".to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&temporary, std::fs::Permissions::from_mode(0o600))
            .map_err(|_| "failed to secure local CLI settings".to_string())?;
    }
    std::fs::rename(&temporary, &path)
        .map_err(|_| "failed to replace local CLI settings".to_string())
}

fn valid_executable_name(provider: LocalAgentProvider, path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    #[cfg(windows)]
    {
        return name.eq_ignore_ascii_case(&format!("{}.exe", provider.command_name()));
    }
    #[cfg(not(windows))]
    {
        name == provider.command_name()
    }
}

fn validate_executable_path(provider: LocalAgentProvider, path: &Path) -> Result<PathBuf, String> {
    if path.as_os_str().len() > MAX_PATH_BYTES {
        return Err("local CLI path is too long".to_string());
    }
    if !path.is_absolute() || !valid_executable_name(provider, path) {
        return Err(format!(
            "select the native {} executable",
            provider.command_name()
        ));
    }
    let canonical = std::fs::canonicalize(path)
        .map_err(|_| "local CLI executable does not exist".to_string())?;
    if !canonical.is_file() {
        return Err("local CLI path is not a file".to_string());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if canonical
            .metadata()
            .map_err(|_| "failed to inspect local CLI executable".to_string())?
            .permissions()
            .mode()
            & 0o111
            == 0
        {
            return Err("local CLI file is not executable".to_string());
        }
    }
    Ok(canonical)
}

fn executable_candidates(provider: LocalAgentProvider) -> Vec<(PathBuf, String)> {
    let file_name = if cfg!(windows) {
        format!("{}.exe", provider.command_name())
    } else {
        provider.command_name().to_string()
    };
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("PATH") {
        for directory in std::env::split_paths(&path) {
            candidates.push((directory.join(&file_name), "path".to_string()));
        }
    }
    #[cfg(not(windows))]
    {
        for directory in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
            candidates.push((
                PathBuf::from(directory).join(&file_name),
                "common".to_string(),
            ));
        }
        if let Some(home) = std::env::var_os("HOME") {
            let home = PathBuf::from(home);
            for directory in [
                ".local/bin",
                ".npm-global/bin",
                ".bun/bin",
                ".volta/bin",
                ".asdf/shims",
                ".cargo/bin",
                ".claude/local",
                "Library/pnpm",
            ] {
                candidates.push((home.join(directory).join(&file_name), "common".to_string()));
            }
            for (root, suffix) in [
                (".nvm/versions/node", "bin"),
                (".fnm/node-versions", "installation/bin"),
            ] {
                if let Ok(entries) = std::fs::read_dir(home.join(root)) {
                    for entry in entries.flatten().take(128) {
                        candidates.push((
                            entry.path().join(suffix).join(&file_name),
                            "common".to_string(),
                        ));
                    }
                }
            }
        }
    }
    #[cfg(windows)]
    {
        if let Some(home) = std::env::var_os("USERPROFILE") {
            candidates.push((
                PathBuf::from(home)
                    .join(".codex")
                    .join("bin")
                    .join(&file_name),
                "common".to_string(),
            ));
        }
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            let local = PathBuf::from(local);
            for directory in ["Programs\\Codex", "Programs\\Claude", "pnpm"] {
                candidates.push((local.join(directory).join(&file_name), "common".to_string()));
            }
        }
        if let Some(program_files) = std::env::var_os("ProgramFiles") {
            for directory in ["Codex", "Claude"] {
                candidates.push((
                    PathBuf::from(&program_files)
                        .join(directory)
                        .join(&file_name),
                    "common".to_string(),
                ));
            }
        }
    }
    candidates
}

fn resolve_executable(
    app: &AppHandle,
    provider: LocalAgentProvider,
) -> Result<Option<(PathBuf, String)>, String> {
    if let Some(path) = read_overrides(app).get(provider) {
        return validate_executable_path(provider, Path::new(path))
            .map(|path| Some((path, "override".to_string())));
    }
    for (candidate, source) in executable_candidates(provider) {
        if candidate.is_file() {
            if let Ok(path) = validate_executable_path(provider, &candidate) {
                return Ok(Some((path, source)));
            }
        }
    }
    Ok(None)
}

async fn command_output(executable: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    command_output_capped(executable, args, PROBE_TIMEOUT, MAX_PROBE_OUTPUT_BYTES).await
}

fn clean_version(output: &std::process::Output) -> Option<String> {
    let text = if output.stdout.is_empty() {
        &output.stderr
    } else {
        &output.stdout
    };
    String::from_utf8_lossy(text)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| line.chars().take(160).collect())
}

async fn probe_path(
    provider: LocalAgentProvider,
    path: PathBuf,
    path_source: String,
) -> LocalAgentProbe {
    let version_output = match command_output(&path, &["--version"]).await {
        Ok(output) if output.status.success() => output,
        Ok(_) => {
            return LocalAgentProbe::unavailable(
                provider,
                LocalAgentAvailability::Unsupported,
                "The selected executable did not report a supported version.".to_string(),
            )
        }
        Err(message) => {
            return LocalAgentProbe::unavailable(provider, LocalAgentAvailability::Error, message)
        }
    };
    let version = clean_version(&version_output);
    let (help_args, required_flags): (&[&str], &[&str]) = match provider {
        LocalAgentProvider::Codex => (&["app-server", "--help"], &["--stdio", "--strict-config"]),
        LocalAgentProvider::Claude => (
            &["--help"],
            &[
                "--input-format",
                "--output-format",
                "--include-partial-messages",
                "--strict-mcp-config",
                "--system-prompt-file",
                "--setting-sources",
                "--permission-mode",
                "--allowedTools",
                "--tools",
                "--resume",
            ],
        ),
    };
    let help = match command_output(&path, help_args).await {
        Ok(output) => {
            String::from_utf8_lossy(&output.stdout).to_string()
                + &String::from_utf8_lossy(&output.stderr)
        }
        Err(message) => {
            return LocalAgentProbe {
                provider,
                availability: LocalAgentAvailability::Unsupported,
                path: Some(path.to_string_lossy().to_string()),
                path_source: Some(path_source),
                version,
                authenticated: false,
                login_command: provider.login_command().to_string(),
                models: Vec::new(),
                efforts: Vec::new(),
                capabilities: Vec::new(),
                message: Some(message),
            }
        }
    };
    if required_flags.iter().any(|flag| !help.contains(flag)) {
        return LocalAgentProbe {
            provider,
            availability: LocalAgentAvailability::Unsupported,
            path: Some(path.to_string_lossy().to_string()),
            path_source: Some(path_source),
            version,
            authenticated: false,
            login_command: provider.login_command().to_string(),
            models: Vec::new(),
            efforts: Vec::new(),
            capabilities: Vec::new(),
            message: Some(
                "The installed CLI is missing required structured-agent capabilities.".to_string(),
            ),
        };
    }
    if provider == LocalAgentProvider::Claude {
        return LocalAgentProbe {
            provider,
            availability: LocalAgentAvailability::Unsupported,
            path: Some(path.to_string_lossy().to_string()),
            path_source: Some(path_source),
            version,
            authenticated: false,
            login_command: provider.login_command().to_string(),
            models: Vec::new(),
            efforts: Vec::new(),
            capabilities: vec!["streamJson".to_string(), "streamableHttpMcp".to_string()],
            message: Some(claude_isolation_error()),
        };
    }

    let (authenticated, models, efforts, capabilities, auth_message) = match provider {
        LocalAgentProvider::Codex => {
            match tokio::time::timeout(PROBE_TIMEOUT, probe_codex_app_server(&path)).await {
                Ok(Ok((authenticated, models))) => (
                    authenticated,
                    models,
                    Vec::new(),
                    vec!["appServer".to_string(), "streamableHttpMcp".to_string()],
                    None,
                ),
                Ok(Err(_)) | Err(_) => {
                    return LocalAgentProbe {
                        provider,
                        availability: LocalAgentAvailability::Error,
                        path: Some(path.to_string_lossy().to_string()),
                        path_source: Some(path_source),
                        version,
                        authenticated: false,
                        login_command: provider.login_command().to_string(),
                        models: Vec::new(),
                        efforts: Vec::new(),
                        capabilities: vec![
                            "appServer".to_string(),
                            "streamableHttpMcp".to_string(),
                        ],
                        message: Some(
                            "Codex account/model probe failed. Re-run login or upgrade the CLI."
                                .to_string(),
                        ),
                    };
                }
            }
        }
        LocalAgentProvider::Claude => {
            let auth = command_output(&path, &["auth", "status", "--json"]).await;
            let authenticated = auth
                .as_ref()
                .ok()
                .filter(|output| output.status.success())
                .and_then(|output| serde_json::from_slice::<serde_json::Value>(&output.stdout).ok())
                .and_then(|value| {
                    value
                        .get("loggedIn")
                        .or_else(|| value.get("authenticated"))
                        .and_then(serde_json::Value::as_bool)
                })
                .unwrap_or(false);
            (
                authenticated,
                Vec::new(),
                Vec::new(),
                vec!["streamJson".to_string(), "streamableHttpMcp".to_string()],
                auth.err(),
            )
        }
    };
    LocalAgentProbe {
        provider,
        availability: if authenticated {
            LocalAgentAvailability::Ready
        } else {
            LocalAgentAvailability::SignedOut
        },
        path: Some(path.to_string_lossy().to_string()),
        path_source: Some(path_source),
        version,
        authenticated,
        login_command: provider.login_command().to_string(),
        models,
        efforts,
        capabilities,
        message: auth_message,
    }
}

async fn probe_path_bounded(
    provider: LocalAgentProvider,
    path: PathBuf,
    path_source: String,
) -> LocalAgentProbe {
    match tokio::time::timeout(
        PROBE_TIMEOUT,
        probe_path(provider, path.clone(), path_source.clone()),
    )
    .await
    {
        Ok(result) => result,
        Err(_) => LocalAgentProbe {
            provider,
            availability: LocalAgentAvailability::Error,
            path: Some(path.to_string_lossy().to_string()),
            path_source: Some(path_source),
            version: None,
            authenticated: false,
            login_command: provider.login_command().to_string(),
            models: Vec::new(),
            efforts: Vec::new(),
            capabilities: Vec::new(),
            message: Some("local CLI capability probe timed out".to_string()),
        },
    }
}

async fn probe(app: &AppHandle, provider: LocalAgentProvider) -> LocalAgentProbe {
    match resolve_executable(app, provider) {
        Ok(Some((path, source))) => probe_path_bounded(provider, path, source).await,
        Ok(None) => LocalAgentProbe::unavailable(
            provider,
            LocalAgentAvailability::NotFound,
            format!(
                "{} was not found on this computer.",
                provider.command_name()
            ),
        ),
        Err(message) => {
            LocalAgentProbe::unavailable(provider, LocalAgentAvailability::Error, message)
        }
    }
}

fn validate_start_request(request: &LocalAgentStartRequest) -> Result<(), String> {
    let request_bytes = serde_json::to_vec(request)
        .map_err(|_| "failed to serialize local agent request".to_string())?
        .len();
    if request_bytes > MAX_START_REQUEST_BYTES {
        return Err("local agent request exceeds the request limit".to_string());
    }
    if !matches!(
        request.mode.as_str(),
        "chat" | "plan" | "auto_qa" | "subagent"
    ) {
        return Err("invalid local agent execution mode".to_string());
    }
    if request.native_search && matches!(request.mode.as_str(), "auto_qa" | "subagent") {
        return Err("native search is not allowed in isolated execution modes".to_string());
    }
    if request.prompt.trim().is_empty() {
        return Err("local agent prompt is required".to_string());
    }
    if request.tools.len() > MAX_TOOL_COUNT {
        return Err(format!("too many local agent tools (max {MAX_TOOL_COUNT})"));
    }
    if request.max_tool_calls == 0 || request.max_tool_calls > MAX_TOOL_CALLS_PER_RUN {
        return Err(format!(
            "invalid local agent tool-call budget (expected 1..={MAX_TOOL_CALLS_PER_RUN})"
        ));
    }
    for tool in &request.tools {
        if tool.name.is_empty()
            || tool.name.len() > MAX_TOOL_NAME_BYTES
            || tool.name.chars().any(char::is_control)
            || tool.description.len() > MAX_TOOL_DESCRIPTION_BYTES
            || !tool.input_schema.is_object()
        {
            return Err("invalid local agent tool definition".to_string());
        }
    }
    for value in [
        request.model.as_deref(),
        request.effort.as_deref(),
        request.session_id.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        if value.len() > 256 || value.chars().any(char::is_control) {
            return Err("invalid local agent option".to_string());
        }
    }
    Ok(())
}

fn validate_requested_preferences(
    request: &LocalAgentStartRequest,
    probe: &LocalAgentProbe,
) -> Result<(), String> {
    let selected_model = request.model.as_deref().filter(|value| !value.is_empty());
    let model = selected_model
        .map(|id| {
            probe
                .models
                .iter()
                .find(|model| model.id == id)
                .ok_or_else(|| "the selected model is not reported by the local CLI".to_string())
        })
        .transpose()?;
    if let Some(effort) = request.effort.as_deref().filter(|value| !value.is_empty()) {
        let supported = model
            .or_else(|| probe.models.iter().find(|model| model.is_default))
            .map(|model| model.efforts.as_slice())
            .unwrap_or(probe.efforts.as_slice());
        if !supported.iter().any(|supported| supported == effort) {
            return Err(
                "the selected reasoning effort is not reported by the local CLI".to_string(),
            );
        }
    }
    Ok(())
}

fn create_run_directory() -> Result<PathBuf, String> {
    let path = std::env::temp_dir().join(format!("open-builder-agent-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&path)
        .map_err(|_| "failed to create isolated local agent directory".to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))
            .map_err(|_| "failed to secure isolated local agent directory".to_string())?;
    }
    Ok(path)
}

#[tauri::command]
pub async fn local_agent_probe(app: AppHandle, provider: LocalAgentProvider) -> LocalAgentProbe {
    probe(&app, provider).await
}

#[tauri::command]
pub async fn local_agent_choose_executable(
    app: AppHandle,
    provider: LocalAgentProvider,
) -> Result<Option<LocalAgentProbe>, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_file(move |selected| {
        let _ = sender.send(selected);
    });
    let Some(selected) = receiver
        .await
        .map_err(|_| "executable picker was cancelled".to_string())?
    else {
        return Ok(None);
    };
    let selected = selected
        .into_path()
        .map_err(|_| "selected executable path is invalid".to_string())?;
    let canonical = validate_executable_path(provider, &selected)?;
    let probe_result =
        probe_path_bounded(provider, canonical.clone(), "override".to_string()).await;
    if probe_result.availability == LocalAgentAvailability::Unsupported
        || probe_result.availability == LocalAgentAvailability::Error
    {
        return Err(probe_result
            .message
            .unwrap_or_else(|| "selected executable is unsupported".to_string()));
    }
    let mut overrides = read_overrides(&app);
    overrides.set(provider, Some(selected.to_string_lossy().to_string()));
    write_overrides(&app, &overrides)?;
    Ok(Some(probe_result))
}

#[tauri::command]
pub async fn local_agent_clear_executable(
    app: AppHandle,
    provider: LocalAgentProvider,
) -> Result<LocalAgentProbe, String> {
    let mut overrides = read_overrides(&app);
    overrides.set(provider, None);
    write_overrides(&app, &overrides)?;
    Ok(probe(&app, provider).await)
}

#[tauri::command]
pub async fn local_agent_start(
    app: AppHandle,
    state: tauri::State<'_, LocalAgentState>,
    request: LocalAgentStartRequest,
    on_event: tauri::ipc::Channel<LocalAgentEvent>,
) -> Result<String, String> {
    validate_start_request(&request)?;
    let (executable, path_source) = resolve_executable(&app, request.provider)?
        .ok_or_else(|| format!("{} was not found", request.provider.command_name()))?;
    let run_dir = create_run_directory()?;
    let run_id = uuid::Uuid::new_v4().to_string();
    let cancellation = CancellationToken::new();
    let (bridge_url, bridge_token) = match state
        .bridge
        .register(
            run_id.clone(),
            request.tools.clone(),
            request.max_tool_calls,
            cancellation.clone(),
            on_event.clone(),
        )
        .await
    {
        Ok(value) => value,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&run_dir);
            return Err(error);
        }
    };
    {
        let mut runs = state
            .runs
            .lock()
            .map_err(|_| "local agent run lock poisoned".to_string())?;
        if runs.len() >= MAX_ACTIVE_RUNS {
            state.bridge.unregister(&run_id, "run limit reached");
            let _ = std::fs::remove_dir_all(&run_dir);
            return Err(format!(
                "too many active local agent runs (max {MAX_ACTIVE_RUNS})"
            ));
        }
        runs.insert(
            run_id.clone(),
            ActiveRun {
                cancellation: cancellation.clone(),
                task: None,
                run_dir: run_dir.clone(),
            },
        );
    }

    let runs = state.runs.clone();
    let bridge = state.bridge.clone();
    let task_run_id = run_id.clone();
    let task = tauri::async_runtime::spawn(async move {
        let _ = on_event.send(LocalAgentEvent::Status {
            state: "probing".to_string(),
            message: None,
        });
        let mut work = Box::pin(async {
            let readiness =
                probe_path_bounded(request.provider, executable.clone(), path_source).await;
            if cancellation.is_cancelled() {
                return Ok(crate::local_agent_protocol::ProtocolOutcome {
                    session_id: request.session_id.clone(),
                    aborted: true,
                });
            }
            if readiness.availability != LocalAgentAvailability::Ready {
                return Err(readiness
                    .message
                    .unwrap_or_else(|| match readiness.availability {
                        LocalAgentAvailability::SignedOut => format!(
                            "{} is not signed in; run {}",
                            request.provider.command_name(),
                            request.provider.login_command()
                        ),
                        LocalAgentAvailability::Unsupported => {
                            "the installed local CLI is unsupported".to_string()
                        }
                        _ => "the local CLI is unavailable".to_string(),
                    }));
            }
            validate_requested_preferences(&request, &readiness)?;
            let cli_version = readiness.version.unwrap_or_else(|| "unknown".to_string());
            run_protocol(ProtocolContext {
                executable,
                request,
                run_dir: run_dir.clone(),
                bridge_url,
                bridge_token,
                cancellation: cancellation.clone(),
                channel: on_event.clone(),
                cli_version,
            })
            .await
        });
        let result = match tokio::time::timeout(MAX_RUN_DURATION, work.as_mut()).await {
            Ok(result) => result,
            Err(_) => {
                cancellation.cancel();
                let _ = tokio::time::timeout(RUN_CLEANUP_TIMEOUT, work.as_mut()).await;
                Err("local agent run exceeded the 30 minute limit".to_string())
            }
        };
        // If bounded cooperative cleanup also timed out, dropping this future
        // drops the process-tree guard and kills the Unix PGID / Windows job.
        drop(work);
        match result {
            Ok(outcome) => {
                let _ = on_event.send(LocalAgentEvent::Done {
                    aborted: outcome.aborted,
                    session_id: outcome.session_id,
                });
            }
            Err(message) => {
                let _ = on_event.send(LocalAgentEvent::Error {
                    message,
                    retryable: false,
                });
                let _ = on_event.send(LocalAgentEvent::Done {
                    aborted: cancellation.is_cancelled(),
                    session_id: None,
                });
            }
        }
        bridge.unregister(&task_run_id, "local agent run completed");
        let _ = std::fs::remove_dir_all(&run_dir);
        if let Ok(mut runs) = runs.lock() {
            runs.remove(&task_run_id);
        }
    });
    if let Ok(mut runs) = state.runs.lock() {
        if let Some(active) = runs.get_mut(&run_id) {
            active.task = Some(task);
        }
    }
    Ok(run_id)
}

#[tauri::command]
pub fn local_agent_resolve_tool(
    state: tauri::State<'_, LocalAgentState>,
    run_id: String,
    call_id: String,
    result: LocalToolResolution,
) -> Result<(), String> {
    state.bridge.resolve(&run_id, &call_id, result)
}

#[tauri::command]
pub fn local_agent_cancel(
    state: tauri::State<'_, LocalAgentState>,
    run_id: String,
) -> Result<bool, String> {
    let runs = state
        .runs
        .lock()
        .map_err(|_| "local agent run lock poisoned".to_string())?;
    let Some(run) = runs.get(&run_id) else {
        return Ok(false);
    };
    run.cancellation.cancel();
    state
        .bridge
        .unregister(&run_id, "local agent run cancelled");
    Ok(true)
}

#[tauri::command]
pub fn local_agent_cancel_all(state: tauri::State<'_, LocalAgentState>) -> Result<usize, String> {
    let runs = state
        .runs
        .lock()
        .map_err(|_| "local agent run lock poisoned".to_string())?;
    let count = runs.len();
    for (run_id, run) in runs.iter() {
        run.cancellation.cancel();
        state
            .bridge
            .unregister(run_id, "all local agent runs cancelled");
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> LocalAgentStartRequest {
        LocalAgentStartRequest {
            provider: LocalAgentProvider::Codex,
            model: None,
            effort: None,
            system_prompt: "system".to_string(),
            prompt: "build".to_string(),
            bootstrap_context: None,
            session_id: None,
            tools: vec![LocalToolSpec {
                name: "read_files".to_string(),
                description: "Read files".to_string(),
                input_schema: serde_json::json!({"type":"object"}),
            }],
            max_tool_calls: 32,
            native_search: false,
            mode: "chat".to_string(),
        }
    }

    #[test]
    fn validates_start_request_shape() {
        assert!(validate_start_request(&request()).is_ok());
        let mut invalid = request();
        invalid.mode = "shell".to_string();
        assert!(validate_start_request(&invalid).is_err());
        let mut invalid = request();
        invalid.max_tool_calls = 0;
        assert!(validate_start_request(&invalid).is_err());
        invalid.max_tool_calls = MAX_TOOL_CALLS_PER_RUN + 1;
        assert!(validate_start_request(&invalid).is_err());
        let mut invalid = request();
        invalid.mode = "auto_qa".to_string();
        invalid.native_search = true;
        assert!(validate_start_request(&invalid).is_err());
    }

    #[test]
    fn validates_preferences_against_probe_capabilities() {
        let mut selected = request();
        selected.model = Some("codex-model".to_string());
        selected.effort = Some("high".to_string());
        let probe = LocalAgentProbe {
            provider: LocalAgentProvider::Codex,
            availability: LocalAgentAvailability::Ready,
            path: None,
            path_source: None,
            version: Some("1".to_string()),
            authenticated: true,
            login_command: "codex login".to_string(),
            models: vec![LocalAgentModel {
                id: "codex-model".to_string(),
                display_name: "Codex".to_string(),
                is_default: true,
                default_effort: Some("medium".to_string()),
                efforts: vec!["medium".to_string(), "high".to_string()],
            }],
            efforts: Vec::new(),
            capabilities: Vec::new(),
            message: None,
        };
        assert!(validate_requested_preferences(&selected, &probe).is_ok());
        selected.effort = Some("unsupported".to_string());
        assert!(validate_requested_preferences(&selected, &probe).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn windows_rejects_script_launchers() {
        assert!(!valid_executable_name(
            LocalAgentProvider::Codex,
            Path::new("C:\\tools\\codex.cmd")
        ));
    }
}
