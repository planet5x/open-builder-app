use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::extract::DefaultBodyLimit;
use axum::http::{header::AUTHORIZATION, request::Parts};
use rmcp::model::{
    CallToolRequestParams, CallToolResponse, CallToolResult, ContentBlock, ListToolsResult,
    PaginatedRequestParams, Resource, ResourceContents, ServerCapabilities, ServerInfo, Tool,
};
use rmcp::service::{RequestContext, RoleServer};
use rmcp::transport::{
    streamable_http_server::session::local::LocalSessionManager, StreamableHttpServerConfig,
    StreamableHttpService,
};
use rmcp::{ErrorData, ServerHandler};
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;

use crate::local_agent::{LocalAgentEvent, LocalToolContent, LocalToolResolution, LocalToolSpec};

const MAX_REQUEST_BYTES: usize = 4 * 1024 * 1024;
const MAX_RESULT_BYTES: usize = 20 * 1024 * 1024;
const TOOL_CALL_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const TOOL_CALL_BUDGET_EXHAUSTED: &str = "local agent tool-call budget exhausted";

type PendingResult = Result<LocalToolResolution, String>;

struct BridgeRun {
    run_id: String,
    token: String,
    tools: Vec<Tool>,
    max_tool_calls: usize,
    tool_calls_started: AtomicUsize,
    cancellation: CancellationToken,
    channel: tauri::ipc::Channel<LocalAgentEvent>,
    pending: Mutex<HashMap<String, oneshot::Sender<PendingResult>>>,
}

impl BridgeRun {
    fn abort(&self, reason: &str) {
        self.cancellation.cancel();
        self.cancel_pending(reason);
    }

    fn reserve_tool_call(&self) -> bool {
        let reserved = self
            .tool_calls_started
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |started| {
                (started < self.max_tool_calls).then_some(started + 1)
            })
            .is_ok();
        if !reserved {
            self.abort(TOOL_CALL_BUDGET_EXHAUSTED);
        }
        reserved
    }

    fn cancel_pending(&self, reason: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            for (_, sender) in pending.drain() {
                let _ = sender.send(Err(reason.to_string()));
            }
        }
    }
}

#[derive(Default)]
struct BridgeRegistry {
    by_token: Mutex<HashMap<String, Arc<BridgeRun>>>,
    token_by_run: Mutex<HashMap<String, String>>,
}

impl BridgeRegistry {
    fn run_for_token(&self, token: &str) -> Result<Arc<BridgeRun>, ErrorData> {
        self.by_token
            .lock()
            .map_err(|_| ErrorData::internal_error("tool bridge lock poisoned", None))?
            .get(token)
            .cloned()
            .ok_or_else(|| ErrorData::invalid_request("invalid tool bridge credentials", None))
    }

    fn token_from_context(
        &self,
        context: &RequestContext<RoleServer>,
    ) -> Result<String, ErrorData> {
        let parts = context
            .extensions
            .get::<Parts>()
            .ok_or_else(|| ErrorData::invalid_request("missing HTTP request context", None))?;
        let header = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| ErrorData::invalid_request("missing tool bridge credentials", None))?;
        header
            .strip_prefix("Bearer ")
            .filter(|token| !token.is_empty())
            .map(str::to_string)
            .ok_or_else(|| ErrorData::invalid_request("invalid tool bridge credentials", None))
    }

    fn run_from_context(
        &self,
        context: &RequestContext<RoleServer>,
    ) -> Result<Arc<BridgeRun>, ErrorData> {
        let token = self.token_from_context(context)?;
        self.run_for_token(&token)
    }
}

#[derive(Clone)]
struct OpenBuilderToolServer {
    registry: Arc<BridgeRegistry>,
}

impl ServerHandler for OpenBuilderToolServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_instructions("Open Builder host tools for the current isolated run")
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        let run = self.registry.run_from_context(&context)?;
        Ok(ListToolsResult {
            tools: run.tools.clone(),
            ..Default::default()
        })
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        let run = self.registry.run_from_context(&context)?;
        if run.cancellation.is_cancelled() {
            return Err(ErrorData::invalid_request(
                "local agent run is cancelled",
                None,
            ));
        }
        let name = request.name.to_string();
        if !run.tools.iter().any(|tool| tool.name == name) {
            run.abort("local agent requested an unknown tool");
            return Err(ErrorData::invalid_params(
                "tool is not authorized for this run",
                None,
            ));
        }

        let arguments = serde_json::Value::Object(request.arguments.unwrap_or_default());
        let argument_bytes = serde_json::to_vec(&arguments)
            .map_err(|_| ErrorData::invalid_params("invalid tool arguments", None))?
            .len();
        if argument_bytes > MAX_REQUEST_BYTES {
            run.abort("local agent tool arguments exceeded the request limit");
            return Err(ErrorData::invalid_params(
                "tool arguments exceed the request limit",
                None,
            ));
        }
        if !run.reserve_tool_call() {
            return Err(ErrorData::invalid_request(TOOL_CALL_BUDGET_EXHAUSTED, None));
        }

        let call_id = uuid::Uuid::new_v4().to_string();
        let (sender, receiver) = oneshot::channel();
        run.pending
            .lock()
            .map_err(|_| ErrorData::internal_error("tool call lock poisoned", None))?
            .insert(call_id.clone(), sender);

        if run
            .channel
            .send(LocalAgentEvent::ToolRequest {
                run_id: run.run_id.clone(),
                call_id: call_id.clone(),
                name,
                arguments,
            })
            .is_err()
        {
            if let Ok(mut pending) = run.pending.lock() {
                pending.remove(&call_id);
            }
            return Err(ErrorData::internal_error(
                "tool bridge consumer is unavailable",
                None,
            ));
        }

        let resolution = match tokio::time::timeout(TOOL_CALL_TIMEOUT, receiver).await {
            Ok(Ok(Ok(value))) => value,
            Ok(Ok(Err(message))) => {
                return Ok(CallToolResult::error(vec![ContentBlock::text(message)]).into())
            }
            Ok(Err(_)) => {
                return Ok(CallToolResult::error(vec![ContentBlock::text(
                    "Open Builder cancelled this tool call.",
                )])
                .into())
            }
            Err(_) => {
                if let Ok(mut pending) = run.pending.lock() {
                    pending.remove(&call_id);
                }
                return Ok(CallToolResult::error(vec![ContentBlock::text(
                    "Open Builder tool call timed out.",
                )])
                .into());
            }
        };

        let result_bytes = serde_json::to_vec(&resolution)
            .map_err(|_| ErrorData::internal_error("invalid tool result", None))?
            .len();
        if result_bytes > MAX_RESULT_BYTES {
            return Ok(CallToolResult::error(vec![ContentBlock::text(
                "Open Builder tool result exceeded the response limit.",
            )])
            .into());
        }

        let mut content = resolution
            .content
            .unwrap_or_default()
            .into_iter()
            .map(content_block)
            .collect::<Vec<_>>();
        if content.is_empty() {
            content.push(ContentBlock::text(resolution.text));
        }
        let mut result = if resolution.is_error.unwrap_or(false) {
            CallToolResult::error(content)
        } else {
            CallToolResult::success(content)
        };
        result.structured_content = resolution.structured_content;
        Ok(result.into())
    }
}

fn content_block(content: LocalToolContent) -> ContentBlock {
    match content {
        LocalToolContent::Text { text } => ContentBlock::text(text),
        LocalToolContent::Image { data, mime_type } => ContentBlock::image(data, mime_type),
        LocalToolContent::Audio { data, mime_type } => ContentBlock::audio(data, mime_type),
        LocalToolContent::Resource {
            uri,
            mime_type,
            text,
            blob,
        } => {
            let resource = if let Some(text) = text {
                ResourceContents::text(text, uri)
            } else {
                ResourceContents::blob(blob.unwrap_or_default(), uri)
            };
            ContentBlock::resource(match mime_type {
                Some(mime_type) => resource.with_mime_type(mime_type),
                None => resource,
            })
        }
        LocalToolContent::ResourceLink {
            uri,
            name,
            title,
            description,
            mime_type,
            size,
        } => {
            let mut resource = Resource::new(uri, name);
            if let Some(title) = title {
                resource = resource.with_title(title);
            }
            if let Some(description) = description {
                resource = resource.with_description(description);
            }
            if let Some(mime_type) = mime_type {
                resource = resource.with_mime_type(mime_type);
            }
            if let Some(size) = size {
                resource = resource.with_size(size);
            }
            ContentBlock::resource_link(resource)
        }
    }
}

struct BridgeRuntime {
    url: String,
    cancellation: CancellationToken,
    task: tauri::async_runtime::JoinHandle<()>,
}

pub struct ToolBridge {
    registry: Arc<BridgeRegistry>,
    runtime: tokio::sync::Mutex<Option<BridgeRuntime>>,
}

impl Default for ToolBridge {
    fn default() -> Self {
        Self {
            registry: Arc::new(BridgeRegistry::default()),
            runtime: tokio::sync::Mutex::new(None),
        }
    }
}

impl ToolBridge {
    async fn ensure_started(&self) -> Result<String, String> {
        let mut runtime = self.runtime.lock().await;
        if let Some(runtime) = runtime.as_ref() {
            return Ok(runtime.url.clone());
        }

        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .map_err(|error| format!("failed to bind local tool bridge: {error}"))?;
        let address = listener
            .local_addr()
            .map_err(|error| format!("failed to read local tool bridge address: {error}"))?;
        let cancellation = CancellationToken::new();
        let registry = self.registry.clone();
        let service: StreamableHttpService<OpenBuilderToolServer, LocalSessionManager> =
            StreamableHttpService::new(
                move || {
                    Ok(OpenBuilderToolServer {
                        registry: registry.clone(),
                    })
                },
                Default::default(),
                StreamableHttpServerConfig::default()
                    .with_sse_keep_alive(None)
                    .with_cancellation_token(cancellation.child_token()),
            );
        let router = axum::Router::new()
            .nest_service("/mcp", service)
            .layer(DefaultBodyLimit::max(MAX_REQUEST_BYTES));
        let server_cancellation = cancellation.clone();
        let task = tauri::async_runtime::spawn(async move {
            let _ = axum::serve(listener, router)
                .with_graceful_shutdown(async move {
                    server_cancellation.cancelled_owned().await;
                })
                .await;
        });
        let url = format!("http://127.0.0.1:{}/mcp", address.port());
        *runtime = Some(BridgeRuntime {
            url: url.clone(),
            cancellation,
            task,
        });
        Ok(url)
    }

    pub async fn register(
        &self,
        run_id: String,
        tools: Vec<LocalToolSpec>,
        max_tool_calls: usize,
        cancellation: CancellationToken,
        channel: tauri::ipc::Channel<LocalAgentEvent>,
    ) -> Result<(String, String), String> {
        let url = self.ensure_started().await?;
        let token = format!("{}{}", uuid::Uuid::new_v4(), uuid::Uuid::new_v4());
        let tools = tools
            .into_iter()
            .map(|spec| {
                let schema =
                    spec.input_schema.as_object().cloned().ok_or_else(|| {
                        format!("tool {} has a non-object JSON schema", spec.name)
                    })?;
                Ok(Tool::new_with_raw(
                    Cow::Owned(spec.name),
                    Some(Cow::Owned(spec.description)),
                    Arc::new(schema),
                ))
            })
            .collect::<Result<Vec<_>, String>>()?;
        let run = Arc::new(BridgeRun {
            run_id: run_id.clone(),
            token: token.clone(),
            tools,
            max_tool_calls,
            tool_calls_started: AtomicUsize::new(0),
            cancellation,
            channel,
            pending: Mutex::new(HashMap::new()),
        });
        self.registry
            .by_token
            .lock()
            .map_err(|_| "tool bridge lock poisoned".to_string())?
            .insert(token.clone(), run);
        self.registry
            .token_by_run
            .lock()
            .map_err(|_| "tool bridge lock poisoned".to_string())?
            .insert(run_id, token.clone());
        Ok((url, token))
    }

    pub fn resolve(
        &self,
        run_id: &str,
        call_id: &str,
        result: LocalToolResolution,
    ) -> Result<(), String> {
        let result_bytes = serde_json::to_vec(&result)
            .map_err(|_| "invalid local agent tool result".to_string())?
            .len();
        if result_bytes > MAX_RESULT_BYTES {
            return Err("local agent tool result exceeded the response limit".to_string());
        }
        let token = self
            .registry
            .token_by_run
            .lock()
            .map_err(|_| "tool bridge lock poisoned".to_string())?
            .get(run_id)
            .cloned()
            .ok_or_else(|| "local agent run is not active".to_string())?;
        let run = self
            .registry
            .by_token
            .lock()
            .map_err(|_| "tool bridge lock poisoned".to_string())?
            .get(&token)
            .cloned()
            .ok_or_else(|| "local agent run is not active".to_string())?;
        let sender = run
            .pending
            .lock()
            .map_err(|_| "tool call lock poisoned".to_string())?
            .remove(call_id)
            .ok_or_else(|| "local agent tool call is not pending".to_string())?;
        sender
            .send(Ok(result))
            .map_err(|_| "local agent tool call was cancelled".to_string())
    }

    pub fn unregister(&self, run_id: &str, reason: &str) {
        let token = self
            .registry
            .token_by_run
            .lock()
            .ok()
            .and_then(|mut runs| runs.remove(run_id));
        if let Some(token) = token {
            if let Some(run) = self
                .registry
                .by_token
                .lock()
                .ok()
                .and_then(|mut runs| runs.remove(&token))
            {
                debug_assert_eq!(run.token, token);
                run.cancel_pending(reason);
            }
        }
    }

    pub fn shutdown_now(&self) {
        if let Ok(mut runs) = self.registry.by_token.lock() {
            for (_, run) in runs.drain() {
                run.cancel_pending("application exiting");
            }
        }
        if let Ok(mut runs) = self.registry.token_by_run.lock() {
            runs.clear();
        }
        if let Ok(mut runtime) = self.runtime.try_lock() {
            if let Some(runtime) = runtime.take() {
                runtime.cancellation.cancel();
                runtime.task.abort();
            }
        }
    }
}

impl Drop for ToolBridge {
    fn drop(&mut self) {
        self.shutdown_now();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_missing_bearer_credentials() {
        let registry = BridgeRegistry::default();
        assert!(registry.run_for_token("missing").is_err());
    }

    #[test]
    fn enforces_total_tool_call_budget_atomically() {
        let cancellation = CancellationToken::new();
        let run = BridgeRun {
            run_id: "run".to_string(),
            token: "token".to_string(),
            tools: Vec::new(),
            max_tool_calls: 2,
            tool_calls_started: AtomicUsize::new(0),
            cancellation: cancellation.clone(),
            channel: tauri::ipc::Channel::new(|_| Ok(())),
            pending: Mutex::new(HashMap::new()),
        };
        assert!(run.reserve_tool_call());
        assert!(run.reserve_tool_call());
        let (sender, mut receiver) = oneshot::channel();
        run.pending
            .lock()
            .unwrap()
            .insert("pending".to_string(), sender);
        assert!(!run.reserve_tool_call());
        assert!(cancellation.is_cancelled());
        assert!(matches!(
            receiver.try_recv(),
            Ok(Err(message)) if message == TOOL_CALL_BUDGET_EXHAUSTED
        ));
    }
}
