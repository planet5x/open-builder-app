use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use futures_util::StreamExt;
use serde::Serialize;
use tauri::http::{Request as TauriRequest, Response as TauriResponse};

static PROXY_POLICY: LazyLock<Mutex<ProxyPolicyState>> =
    LazyLock::new(|| Mutex::new(ProxyPolicyState::default()));
const MAX_PROXY_RESPONSE_BYTES: usize = 25 * 1024 * 1024;
const MAX_PROXY_REDIRECTS: usize = 5;
const MAX_PROXY_ORIGINS: usize = 64;
const MAX_PROXY_ORIGIN_BYTES: usize = 512;

#[derive(serde::Deserialize)]
pub struct ProxyPolicy {
    enabled: bool,
    allowed_hosts: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ProxyOriginRule {
    scheme: String,
    host: String,
    port: u16,
    wildcard: bool,
}

#[derive(Default)]
struct ProxyPolicyState {
    enabled: bool,
    allowed_origins: Vec<ProxyOriginRule>,
}

#[tauri::command]
pub fn set_proxy_policy(policy: ProxyPolicy) -> Result<(), String> {
    *PROXY_POLICY
        .lock()
        .map_err(|_| "proxy policy lock poisoned".to_string())? = ProxyPolicyState::default();
    if policy.enabled && policy.allowed_hosts.len() > MAX_PROXY_ORIGINS {
        return Err(format!("too many proxy origins (max {MAX_PROXY_ORIGINS})"));
    }
    let allowed_origins = if policy.enabled {
        policy
            .allowed_hosts
            .into_iter()
            .map(|origin| {
                if origin.len() > MAX_PROXY_ORIGIN_BYTES {
                    return Err("proxy origin exceeds its size limit".to_string());
                }
                parse_proxy_origin_rule(origin.trim())
            })
            .collect::<Result<Vec<_>, _>>()?
    } else {
        Vec::new()
    };
    *PROXY_POLICY
        .lock()
        .map_err(|_| "proxy policy lock poisoned".to_string())? = ProxyPolicyState {
        enabled: policy.enabled,
        allowed_origins,
    };
    Ok(())
}

fn default_port(scheme: &str) -> Result<u16, String> {
    match scheme {
        "http" => Ok(80),
        "https" => Ok(443),
        _ => Err("proxy origin must use HTTP or HTTPS".to_string()),
    }
}

fn parse_proxy_origin_rule(value: &str) -> Result<ProxyOriginRule, String> {
    let value = value.trim().to_lowercase();
    if value.is_empty() {
        return Err("proxy origin rule is empty".to_string());
    }
    if let Some((scheme, rest)) = value.split_once("://") {
        if let Some(wildcard) = rest.strip_prefix("*.") {
            if wildcard.contains(['/', '?', '#', '@', '[', ']']) {
                return Err("invalid wildcard proxy origin".to_string());
            }
            let (host, port) = match wildcard.rsplit_once(':') {
                Some((host, port)) => (
                    host,
                    port.parse::<u16>()
                        .map_err(|_| "invalid wildcard proxy origin port".to_string())?,
                ),
                None => (wildcard, default_port(scheme)?),
            };
            if host.is_empty()
                || host.len() > 253
                || !host.split('.').all(|label| {
                    !label.is_empty()
                        && label.len() <= 63
                        && label
                            .chars()
                            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
                        && !label.starts_with('-')
                        && !label.ends_with('-')
                })
            {
                return Err("invalid wildcard proxy origin host".to_string());
            }
            return Ok(ProxyOriginRule {
                scheme: scheme.to_string(),
                host: host.to_string(),
                port,
                wildcard: true,
            });
        }
    }

    let parsed = reqwest::Url::parse(&value).map_err(|_| "invalid proxy origin".to_string())?;
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("proxy origin must not contain credentials".to_string());
    }
    if parsed.path() != "/" || parsed.query().is_some() || parsed.fragment().is_some() {
        return Err("proxy policy entries must be origins without path or query".to_string());
    }
    let scheme = parsed.scheme();
    let host = parsed
        .host_str()
        .ok_or_else(|| "proxy origin has no host".to_string())?
        .trim_matches(&['[', ']'][..])
        .to_lowercase();
    let port = parsed.port().unwrap_or(default_port(scheme)?);
    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_private_or_special_ip(ip) && !ip.is_loopback() {
            return Err(
                "private, link-local, multicast, reserved, and special literal IP proxy origins are not allowed"
                    .to_string(),
            );
        }
    }
    Ok(ProxyOriginRule {
        scheme: scheme.to_string(),
        host,
        port,
        wildcard: false,
    })
}

fn target_matches_rule(url: &reqwest::Url, rule: &ProxyOriginRule) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    let host = host.trim_matches(&['[', ']'][..]).to_lowercase();
    let Ok(port) = url.port_or_known_default().ok_or(()) else {
        return false;
    };
    if url.scheme() != rule.scheme || port != rule.port {
        return false;
    }
    if rule.wildcard {
        host.ends_with(&format!(".{}", rule.host)) && host.len() > rule.host.len() + 1
    } else {
        host == rule.host
    }
}

pub fn is_url_allowed(target_url: &str) -> Result<(), String> {
    let parsed =
        reqwest::Url::parse(target_url).map_err(|_| "invalid proxy target URL".to_string())?;
    let host = parsed
        .host_str()
        .ok_or_else(|| "proxy target URL has no host".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("proxy target URL must use HTTP or HTTPS".to_string());
    }
    let policy = PROXY_POLICY
        .lock()
        .map_err(|_| "proxy policy lock poisoned".to_string())?;
    if !policy.enabled {
        return Err("proxy is disabled".to_string());
    }
    if policy
        .allowed_origins
        .iter()
        .any(|rule| target_matches_rule(&parsed, rule))
    {
        Ok(())
    } else {
        Err(format!(
            "host \"{host}\" is not allowed by the proxy policy"
        ))
    }
}

pub(crate) fn validate_proxy_redirect(
    previous: &reqwest::Url,
    next: &reqwest::Url,
) -> Result<(), String> {
    if previous.scheme() == "https" && next.scheme() != "https" {
        return Err("proxy redirect cannot downgrade HTTPS to HTTP".to_string());
    }
    if previous.origin() != next.origin() {
        return Err("proxy redirect cannot change origin".to_string());
    }
    is_url_allowed(next.as_str())
}

fn is_private_or_special_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(address) => {
            let octets = address.octets();
            address.is_private()
                || address.is_link_local()
                || address.is_loopback()
                || address.is_unspecified()
                || address.is_multicast()
                || address.is_broadcast()
                || octets[0] == 0
                || (octets[0] == 100 && (64..=127).contains(&octets[1]))
                || (octets[0] == 192 && octets[1] == 0 && octets[2] == 0)
                || (octets[0] == 192 && octets[1] == 0 && octets[2] == 2)
                || (octets[0] == 192 && octets[1] == 88 && octets[2] == 99)
                || (octets[0] == 198 && matches!(octets[1], 18 | 19))
                || (octets[0] == 198 && octets[1] == 51 && octets[2] == 100)
                || (octets[0] == 203 && octets[1] == 0 && octets[2] == 113)
                || octets[0] >= 240
        }
        IpAddr::V6(address) => {
            let segments = address.segments();
            address.is_unique_local()
                || address.is_unicast_link_local()
                || address.is_loopback()
                || address.is_unspecified()
                || address.is_multicast()
                || address
                    .to_ipv4_mapped()
                    .is_some_and(|mapped| is_private_or_special_ip(IpAddr::V4(mapped)))
                || !(0x2000..=0x3fff).contains(&segments[0])
                || (segments[0] == 0x2001 && segments[1] <= 0x01ff)
                || (segments[0] == 0x2001 && segments[1] == 0x0db8)
                || segments[0] == 0x2002
                || (segments[0] == 0x3fff && segments[1] & 0xf000 == 0)
        }
    }
}

pub(crate) async fn resolve_and_validate_target(
    url: &reqwest::Url,
) -> Result<Option<SocketAddr>, String> {
    let host = url
        .host_str()
        .ok_or_else(|| "proxy target URL has no host".to_string())?;
    if host.parse::<IpAddr>().is_ok() {
        let ip = host
            .parse::<IpAddr>()
            .map_err(|_| "invalid proxy literal IP".to_string())?;
        if is_private_or_special_ip(ip) && !ip.is_loopback() {
            return Err(
                "proxy literal IP is private, link-local, multicast, reserved, or special"
                    .to_string(),
            );
        }
        // An exact allowlist entry is required before this point. Loopback is
        // the only special literal class permitted by that explicit rule.
        return Ok(None);
    }
    let port = url
        .port_or_known_default()
        .ok_or_else(|| "proxy target URL has no known port".to_string())?;
    let host_owned = host.to_string();
    let lookup_host = host_owned.clone();
    let addresses = tauri::async_runtime::spawn_blocking(move || {
        (lookup_host.as_str(), port)
            .to_socket_addrs()
            .map(|iter| iter.collect::<Vec<_>>())
    })
    .await
    .map_err(|error| format!("proxy DNS task failed: {error}"))?
    .map_err(|error| format!("proxy DNS lookup failed: {error}"))?;
    if addresses.is_empty() {
        return Err("proxy DNS lookup returned no addresses".to_string());
    }
    if !host_owned.eq_ignore_ascii_case("localhost")
        && addresses
            .iter()
            .any(|address| is_private_or_special_ip(address.ip()))
    {
        return Err(
            "proxy DNS result points to a private, loopback, link-local, or special address"
                .to_string(),
        );
    }
    Ok(addresses.first().copied())
}

pub(crate) async fn build_validated_http_client(
    url: &reqwest::Url,
    timeout: Option<Duration>,
) -> Result<reqwest::Client, String> {
    is_url_allowed(url.as_str())?;
    let pinned = resolve_and_validate_target(url).await?;
    let mut builder =
        reqwest::Client::builder().redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= MAX_PROXY_REDIRECTS {
                return attempt.error("too many proxy redirects");
            }
            let Some(previous) = attempt.previous().last() else {
                return attempt.error("proxy redirect has no source URL");
            };
            match validate_proxy_redirect(previous, attempt.url()) {
                Ok(()) => attempt.follow(),
                Err(error) => attempt.error(error),
            }
        }));
    if let Some(timeout) = timeout {
        builder = builder.timeout(timeout);
    }
    if let (Some(host), Some(address)) = (url.host_str(), pinned) {
        builder = builder.resolve(host, address);
    }
    builder
        .build()
        .map_err(|_| "failed to create proxy HTTP client".to_string())
}

fn format_authority(host: &str, port: Option<u16>) -> String {
    let host_part = if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]")
    } else {
        host.to_string()
    };
    match port {
        Some(port) => format!("{host_part}:{port}"),
        None => host_part,
    }
}

/// Parse the proxy URL to extract the real target URL.
///
/// Input:  `proxy-https://api.openai.com/v1/chat/completions?stream=true`
/// Output: `https://api.openai.com/v1/chat/completions?stream=true`
///
/// Input:  `proxy-http://localhost:11434/v1/chat/completions`
/// Output: `http://localhost:11434/v1/chat/completions`
fn parse_proxy_url(uri: &str) -> Result<String, String> {
    let parsed = reqwest::Url::parse(uri).map_err(|_| "invalid proxy URI".to_string())?;
    let scheme = match parsed.scheme() {
        "proxy-http" => "http",
        "proxy-https" => "https",
        _ => return Err("proxy URI must use proxy-http:// or proxy-https://".to_string()),
    };
    let host = parsed
        .host_str()
        .ok_or_else(|| "proxy target URL has no host".to_string())?;
    let authority = format_authority(host, parsed.port());
    let path = parsed.path();
    let query = match parsed.query() {
        Some(query) => format!("?{query}"),
        None => String::new(),
    };
    Ok(format!("{scheme}://{authority}{path}{query}"))
}

/// Build an HTTP response with CORS headers injected.
fn build_cors_response(
    status: u16,
    body: Vec<u8>,
    extra_headers: HashMap<String, String>,
) -> TauriResponse<Vec<u8>> {
    let mut builder = TauriResponse::builder()
        .status(status)
        .header("Access-Control-Allow-Origin", "*")
        .header(
            "Access-Control-Allow-Methods",
            "GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD",
        )
        .header("Access-Control-Allow-Headers", "*")
        .header("Access-Control-Expose-Headers", "*")
        .header("Access-Control-Max-Age", "86400");

    for (k, v) in &extra_headers {
        builder = builder.header(k.as_str(), v.as_str());
    }

    builder.body(body).unwrap()
}

/// Build a JSON error response with CORS headers.
fn error_response(status: u16, error: &str, detail: &str) -> TauriResponse<Vec<u8>> {
    #[derive(Serialize)]
    struct ProxyError<'a> {
        error: &'a str,
        detail: &'a str,
    }

    let body = serde_json::to_vec(&ProxyError { error, detail }).unwrap_or_else(|_| {
        br#"{"error":"Proxy error","detail":"failed to serialize error"}"#.to_vec()
    });
    let mut headers = HashMap::new();
    headers.insert("content-type".to_string(), "application/json".to_string());
    build_cors_response(status, body, headers)
}

async fn collect_limited_response_body(resp: reqwest::Response) -> Result<Vec<u8>, String> {
    if let Some(length) = resp.content_length() {
        if length > MAX_PROXY_RESPONSE_BYTES as u64 {
            return Err(format!(
                "response body exceeds {} bytes",
                MAX_PROXY_RESPONSE_BYTES
            ));
        }
    }

    let mut body = Vec::new();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "failed to read proxy response".to_string())?;
        if body.len().saturating_add(chunk.len()) > MAX_PROXY_RESPONSE_BYTES {
            return Err(format!(
                "response body exceeds {} bytes",
                MAX_PROXY_RESPONSE_BYTES
            ));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn classify_proxy_request_error(error: &reqwest::Error) -> (&'static str, &'static str, u16) {
    if error.is_timeout() {
        ("Proxy request timed out", "upstream request timed out", 504)
    } else {
        ("Proxy connection failed", "upstream request failed", 502)
    }
}

/// Handle a single proxy request.
async fn handle_proxy(request: TauriRequest<Vec<u8>>) -> TauriResponse<Vec<u8>> {
    // 1. Parse the target URL
    let uri = request.uri().to_string();
    let target_url = match parse_proxy_url(&uri) {
        Ok(url) => url,
        Err(e) => return error_response(400, "Invalid proxy URL", &e),
    };
    if let Err(e) = is_url_allowed(&target_url) {
        return error_response(403, "Proxy target blocked", &e);
    }
    let parsed_target = match reqwest::Url::parse(&target_url) {
        Ok(url) => url,
        Err(_) => {
            return error_response(400, "Invalid proxy URL", "invalid proxy target URL");
        }
    };
    let client =
        match build_validated_http_client(&parsed_target, Some(Duration::from_secs(300))).await {
            Ok(client) => client,
            Err(error) => return error_response(403, "Proxy target blocked", &error),
        };

    // 2. Handle CORS preflight
    if request.method() == "OPTIONS" {
        return build_cors_response(204, Vec::new(), HashMap::new());
    }

    // 3. Build the reqwest request
    let method: reqwest::Method = request
        .method()
        .as_str()
        .parse()
        .unwrap_or(reqwest::Method::GET);

    let mut builder = client.request(method, parsed_target);

    // Forward request headers, filtering out browser-internal ones
    for (key, value) in request.headers() {
        let k = key.as_str().to_lowercase();
        if k == "host" || k == "origin" {
            continue;
        }
        if let Ok(v) = value.to_str() {
            builder = builder.header(key.as_str(), v);
        }
    }

    // Forward request body
    let body = request.body().clone();
    if !body.is_empty() {
        builder = builder.body(body);
    }

    // 4. Send the request and build the response
    match builder.send().await {
        Ok(resp) => {
            let status = resp.status().as_u16();

            // Collect response headers (skip original CORS headers, we inject our own)
            let mut headers = HashMap::new();
            for (key, value) in resp.headers().iter() {
                let k = key.as_str().to_lowercase();
                if !k.starts_with("access-control-") {
                    if let Ok(v) = value.to_str() {
                        headers.insert(k, v.to_string());
                    }
                }
            }

            match collect_limited_response_body(resp).await {
                Ok(body_bytes) => build_cors_response(status, body_bytes, headers),
                Err(e) => error_response(502, "Proxy response too large", &e),
            }
        }
        Err(e) => {
            let (label, detail, status) = classify_proxy_request_error(&e);
            error_response(status, label, detail)
        }
    }
}

/// Register explicit HTTP and HTTPS custom protocols.
pub fn register_proxy_protocol(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder
        .register_asynchronous_uri_scheme_protocol("proxy-http", |_app, request, responder| {
            tauri::async_runtime::spawn(async move {
                let response = handle_proxy(request).await;
                responder.respond(response);
            });
        })
        .register_asynchronous_uri_scheme_protocol("proxy-https", |_app, request, responder| {
            tauri::async_runtime::spawn(async move {
                let response = handle_proxy(request).await;
                responder.respond(response);
            });
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    static PROXY_TEST_LOCK: Mutex<()> = Mutex::new(());

    fn set_test_policy(enabled: bool, origins: &[&str]) {
        set_proxy_policy(ProxyPolicy {
            enabled,
            allowed_hosts: origins.iter().map(|value| (*value).to_string()).collect(),
        })
        .unwrap();
    }

    #[test]
    fn parse_proxy_url_preserves_host_port_path_and_query() {
        assert_eq!(
            parse_proxy_url("proxy-https://api.openai.com/v1/chat?stream=true").unwrap(),
            "https://api.openai.com/v1/chat?stream=true"
        );
        assert_eq!(
            parse_proxy_url("proxy-http://localhost:11434/v1/chat").unwrap(),
            "http://localhost:11434/v1/chat"
        );
        assert_eq!(
            parse_proxy_url("proxy-http://[::1]:11434/v1/chat").unwrap(),
            "http://[::1]:11434/v1/chat"
        );
        assert_eq!(
            parse_proxy_url("proxy-https://203.0.113.10:8443/v1/chat").unwrap(),
            "https://203.0.113.10:8443/v1/chat"
        );
    }

    #[test]
    fn error_response_escapes_json_detail() {
        let response = error_response(400, "Invalid proxy URL", "bad \"url\"\nnext");
        let value: serde_json::Value =
            serde_json::from_slice(response.body()).expect("valid JSON error body");

        assert_eq!(value["error"], "Invalid proxy URL");
        assert_eq!(value["detail"], "bad \"url\"\nnext");
    }

    #[test]
    fn redirects_revalidate_origin_and_reject_tls_downgrades() {
        let _guard = PROXY_TEST_LOCK.lock().unwrap();
        set_test_policy(true, &["https://api.example.com"]);
        let start = reqwest::Url::parse("https://api.example.com/start").unwrap();
        let same = reqwest::Url::parse("https://api.example.com/next").unwrap();
        let downgrade = reqwest::Url::parse("http://api.example.com/next").unwrap();
        let cross_origin = reqwest::Url::parse("https://evil.example/next").unwrap();

        assert!(validate_proxy_redirect(&start, &same).is_ok());
        assert!(validate_proxy_redirect(&start, &downgrade)
            .unwrap_err()
            .contains("downgrade"));
        assert!(validate_proxy_redirect(&start, &cross_origin)
            .unwrap_err()
            .contains("change origin"));
        set_test_policy(false, &[]);
    }

    #[test]
    fn classifies_private_loopback_and_link_local_addresses() {
        for value in [
            "127.0.0.1",
            "10.0.0.1",
            "100.64.0.1",
            "169.254.1.1",
            "192.0.2.10",
            "198.18.0.1",
            "203.0.113.10",
            "240.0.0.1",
            "::1",
            "fe80::1",
            "2001:db8::1",
            "ff02::1",
        ] {
            assert!(is_private_or_special_ip(value.parse().unwrap()));
        }
        assert!(!is_private_or_special_ip("8.8.8.8".parse().unwrap()));
        assert!(!is_private_or_special_ip(
            "2001:4860:4860::8888".parse().unwrap()
        ));
    }

    #[test]
    fn policy_matches_exact_scheme_host_and_effective_port() {
        let _guard = PROXY_TEST_LOCK.lock().unwrap();
        set_test_policy(true, &["http://localhost:11434", "https://api.example.com"]);

        assert!(is_url_allowed("http://localhost:11434/v1").is_ok());
        assert!(is_url_allowed("http://localhost:3000/v1").is_err());
        assert!(is_url_allowed("https://localhost:11434/v1").is_err());
        assert!(is_url_allowed("https://api.example.com:443/v1").is_ok());
        assert!(is_url_allowed("https://api.example.com:8443/v1").is_err());
        set_test_policy(false, &[]);
    }

    #[test]
    fn disabled_policy_blocks_direct_custom_protocol_targets() {
        let _guard = PROXY_TEST_LOCK.lock().unwrap();
        set_test_policy(false, &["https://api.example.com"]);
        assert!(is_url_allowed("https://api.example.com/v1").is_err());
    }

    #[test]
    fn only_explicit_loopback_literal_special_addresses_are_allowed() {
        let _guard = PROXY_TEST_LOCK.lock().unwrap();
        set_test_policy(true, &["http://127.0.0.1:11434"]);
        assert!(is_url_allowed("http://127.0.0.1:11434/v1").is_ok());

        for origin in [
            "http://10.0.0.1:80",
            "http://100.64.0.1:80",
            "http://169.254.1.1:80",
            "http://192.0.2.1:80",
            "http://198.18.0.1:80",
            "http://203.0.113.1:80",
            "http://[fe80::1]:80",
            "http://[2001:db8::1]:80",
            "http://[ff02::1]:80",
        ] {
            assert!(set_proxy_policy(ProxyPolicy {
                enabled: true,
                allowed_hosts: vec![origin.to_string()],
            })
            .is_err());
        }
        set_test_policy(false, &[]);
    }

    #[test]
    fn upstream_errors_do_not_echo_target_secrets() {
        let secret = "do-not-echo-this-secret";
        let error = reqwest::Client::new()
            .get(format!("http://[{secret}"))
            .build()
            .expect_err("invalid URL should fail");
        let (label, detail, _) = classify_proxy_request_error(&error);
        assert!(!label.contains(secret));
        assert!(!detail.contains(secret));
    }
}
