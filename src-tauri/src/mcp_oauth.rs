use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::time::{timeout_at, Instant};

const MAX_ACTIVE_CALLBACKS: usize = 8;
const MAX_REQUEST_ID_CHARS: usize = 128;
const MAX_REQUEST_BYTES: usize = 16 * 1024;
const MIN_TIMEOUT_MS: u64 = 1_000;
const MAX_TIMEOUT_MS: u64 = 10 * 60 * 1_000;

#[derive(Clone, Serialize)]
#[serde(tag = "type")]
pub enum McpOAuthPayload {
    Callback { url: String },
    Timeout,
    Cancelled,
    Error { message: String },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpOAuthLoopbackStart {
    redirect_uri: String,
}

pub struct McpOAuthState {
    listeners: Arc<Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>>,
}

impl Default for McpOAuthState {
    fn default() -> Self {
        Self {
            listeners: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl McpOAuthState {
    pub fn shutdown_now(&self) {
        if let Ok(mut listeners) = self.listeners.lock() {
            for (_, task) in listeners.drain() {
                task.abort();
            }
        }
    }
}

impl Drop for McpOAuthState {
    fn drop(&mut self) {
        self.shutdown_now();
    }
}

fn validate_request_id(request_id: &str) -> Result<(), String> {
    if request_id.is_empty() {
        return Err("MCP OAuth request id is required".to_string());
    }
    if request_id.len() > MAX_REQUEST_ID_CHARS {
        return Err(format!(
            "MCP OAuth request id exceeds {MAX_REQUEST_ID_CHARS} characters"
        ));
    }
    if !request_id
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return Err("MCP OAuth request id contains invalid characters".to_string());
    }
    Ok(())
}

fn parse_request_target(request: &[u8], expected_path: &str) -> Result<Option<String>, String> {
    let request = std::str::from_utf8(request)
        .map_err(|_| "OAuth callback request was not valid HTTP".to_string())?;
    let Some(request_line) = request.lines().next() else {
        return Err("OAuth callback request was empty".to_string());
    };
    let mut parts = request_line.split_ascii_whitespace();
    let method = parts.next().unwrap_or_default();
    let target = parts.next().unwrap_or_default();
    let version = parts.next().unwrap_or_default();
    if method != "GET" || !matches!(version, "HTTP/1.0" | "HTTP/1.1") || parts.next().is_some() {
        return Ok(None);
    }
    if !target.starts_with('/') || target.starts_with("//") {
        return Ok(None);
    }
    let path = target.split('?').next().unwrap_or_default();
    if path != expected_path {
        return Ok(None);
    }
    Ok(Some(target.to_string()))
}

async fn read_request(stream: &mut TcpStream, deadline: Instant) -> Result<Vec<u8>, String> {
    let mut request = Vec::with_capacity(1024);
    loop {
        if request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
            return Ok(request);
        }
        if request.len() >= MAX_REQUEST_BYTES {
            return Err("OAuth callback request was too large".to_string());
        }

        let mut chunk = [0_u8; 1024];
        let read = timeout_at(deadline, stream.read(&mut chunk))
            .await
            .map_err(|_| "OAuth callback request timed out".to_string())?
            .map_err(|_| "OAuth callback request could not be read".to_string())?;
        if read == 0 {
            return Err("OAuth callback connection closed early".to_string());
        }
        let remaining = MAX_REQUEST_BYTES - request.len();
        request.extend_from_slice(&chunk[..read.min(remaining)]);
    }
}

async fn write_response(stream: &mut TcpStream, status: &str, body: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}

async fn wait_for_callback(
    listener: TcpListener,
    redirect_uri: String,
    expected_path: String,
    deadline: Instant,
) -> Result<String, String> {
    loop {
        let (mut stream, _) = timeout_at(deadline, listener.accept())
            .await
            .map_err(|_| "OAuth callback timed out".to_string())?
            .map_err(|_| "OAuth callback listener failed".to_string())?;

        let request_deadline = deadline.min(Instant::now() + Duration::from_secs(5));
        let request = match read_request(&mut stream, request_deadline).await {
            Ok(request) => request,
            Err(_) => {
                write_response(
                    &mut stream,
                    "400 Bad Request",
                    "<!doctype html><title>Invalid callback</title><p>The OAuth callback was invalid.</p>",
                )
                .await;
                continue;
            }
        };

        let Some(target) = parse_request_target(&request, &expected_path)? else {
            write_response(
                &mut stream,
                "404 Not Found",
                "<!doctype html><title>Not found</title><p>This callback is not active.</p>",
            )
            .await;
            continue;
        };

        let callback_url = if let Some((_, query)) = target.split_once('?') {
            format!("{redirect_uri}?{query}")
        } else {
            redirect_uri
        };
        write_response(
            &mut stream,
            "200 OK",
            "<!doctype html><title>Authorization complete</title><p>You can close this window and return to Open Builder.</p>",
        )
        .await;
        return Ok(callback_url);
    }
}

#[tauri::command]
pub async fn mcp_oauth_start_loopback(
    app: AppHandle,
    state: tauri::State<'_, McpOAuthState>,
    request_id: String,
    timeout_ms: Option<u64>,
) -> Result<McpOAuthLoopbackStart, String> {
    validate_request_id(&request_id)?;
    let timeout_ms = timeout_ms
        .unwrap_or(120_000)
        .clamp(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);

    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .map_err(|_| "failed to bind MCP OAuth loopback listener".to_string())?;
    let address = listener
        .local_addr()
        .map_err(|_| "failed to read MCP OAuth loopback address".to_string())?;
    let callback_token = uuid::Uuid::new_v4().simple().to_string();
    let expected_path = format!("/mcp-oauth/callback/{callback_token}");
    let redirect_uri = format!("http://127.0.0.1:{}{expected_path}", address.port());
    let event_name = format!("mcp-oauth://{request_id}");
    let listeners = state.listeners.clone();
    let cleanup_id = request_id.clone();

    {
        let active = listeners
            .lock()
            .map_err(|_| "MCP OAuth listener lock poisoned".to_string())?;
        if active.len() >= MAX_ACTIVE_CALLBACKS && !active.contains_key(&request_id) {
            return Err(format!(
                "too many active MCP OAuth callbacks (max {MAX_ACTIVE_CALLBACKS})"
            ));
        }
        if active.contains_key(&request_id) {
            return Err("MCP OAuth request id is already active".to_string());
        }
    }

    let task_redirect_uri = redirect_uri.clone();
    let cleanup_listeners = listeners.clone();
    let (start_tx, start_rx) = tokio::sync::oneshot::channel();
    let task = tauri::async_runtime::spawn(async move {
        if start_rx.await.is_err() {
            return;
        }
        let deadline = Instant::now() + Duration::from_millis(timeout_ms);
        let payload =
            match wait_for_callback(listener, task_redirect_uri, expected_path, deadline).await {
                Ok(url) => McpOAuthPayload::Callback { url },
                Err(error) if error == "OAuth callback timed out" => McpOAuthPayload::Timeout,
                Err(_) => McpOAuthPayload::Error {
                    message: "MCP OAuth callback failed".to_string(),
                },
            };
        let _ = app.emit(&event_name, payload);
        if let Ok(mut active) = cleanup_listeners.lock() {
            active.remove(&cleanup_id);
        }
    });

    state
        .listeners
        .lock()
        .map_err(|_| "MCP OAuth listener lock poisoned".to_string())?
        .insert(request_id, task);
    let _ = start_tx.send(());

    Ok(McpOAuthLoopbackStart { redirect_uri })
}

#[tauri::command]
pub async fn mcp_oauth_cancel_loopback(
    app: AppHandle,
    state: tauri::State<'_, McpOAuthState>,
    request_id: String,
) -> Result<(), String> {
    validate_request_id(&request_id)?;
    if let Some(task) = state
        .listeners
        .lock()
        .map_err(|_| "MCP OAuth listener lock poisoned".to_string())?
        .remove(&request_id)
    {
        task.abort();
        let event_name = format!("mcp-oauth://{request_id}");
        let _ = app.emit(&event_name, McpOAuthPayload::Cancelled);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_expected_get_callback_path() {
        let request =
            b"GET /mcp-oauth/callback/token?code=abc&state=xyz HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
        assert_eq!(
            parse_request_target(request, "/mcp-oauth/callback/token").unwrap(),
            Some("/mcp-oauth/callback/token?code=abc&state=xyz".to_string())
        );
        assert_eq!(
            parse_request_target(request, "/mcp-oauth/callback/other").unwrap(),
            None
        );
    }

    #[test]
    fn rejects_non_get_and_absolute_form_callback_requests() {
        assert_eq!(
            parse_request_target(
                b"POST /mcp-oauth/callback/token HTTP/1.1\r\n\r\n",
                "/mcp-oauth/callback/token",
            )
            .unwrap(),
            None
        );
        assert_eq!(
            parse_request_target(
                b"GET http://attacker.invalid/ HTTP/1.1\r\n\r\n",
                "/mcp-oauth/callback/token",
            )
            .unwrap(),
            None
        );
    }

    #[test]
    fn validates_oauth_request_ids() {
        assert!(validate_request_id("oauth-123").is_ok());
        assert!(validate_request_id("").is_err());
        assert!(validate_request_id("bad/id").is_err());
    }

    #[tokio::test]
    async fn receives_one_shot_loopback_callback() {
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .expect("loopback listener should bind");
        let address = listener.local_addr().expect("listener has an address");
        let expected_path = "/mcp-oauth/callback/test-token".to_string();
        let redirect_uri = format!("http://127.0.0.1:{}{expected_path}", address.port());
        let callback = tauri::async_runtime::spawn(wait_for_callback(
            listener,
            redirect_uri.clone(),
            expected_path.clone(),
            Instant::now() + Duration::from_secs(2),
        ));

        let mut stream = TcpStream::connect(address)
            .await
            .expect("test client should connect");
        stream
            .write_all(
                format!(
                    "GET {expected_path}?code=abc&state=xyz HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n"
                )
                .as_bytes(),
            )
            .await
            .expect("test callback should be written");
        let mut response = Vec::new();
        stream
            .read_to_end(&mut response)
            .await
            .expect("test response should be readable");

        let callback_url = callback
            .await
            .expect("callback task should join")
            .expect("callback should succeed");
        assert_eq!(callback_url, format!("{redirect_uri}?code=abc&state=xyz"));
        assert!(response.starts_with(b"HTTP/1.1 200 OK"));
    }
}
