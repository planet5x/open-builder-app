import { readFileSync } from "node:fs";

const tauriConfig = JSON.parse(
  readFileSync(
    new URL("../src-tauri/tauri.conf.json", import.meta.url),
    "utf8",
  ),
);
const capabilities = JSON.parse(
  readFileSync(
    new URL("../src-tauri/capabilities/default.json", import.meta.url),
    "utf8",
  ),
);
const tauriLib = readFileSync(
  new URL("../src-tauri/src/lib.rs", import.meta.url),
  "utf8",
);
const skillImporter = readFileSync(
  new URL("../src/lib/skills/importer.ts", import.meta.url),
  "utf8",
);
const settingsSystem = readFileSync(
  new URL("../src/store/settings/system.ts", import.meta.url),
  "utf8",
);
const localAgent = readFileSync(
  new URL("../src-tauri/src/local_agent.rs", import.meta.url),
  "utf8",
);
const localAgentProtocol = readFileSync(
  new URL("../src-tauri/src/local_agent_protocol.rs", import.meta.url),
  "utf8",
);
const localAgentBridge = readFileSync(
  new URL("../src-tauri/src/local_agent_bridge.rs", import.meta.url),
  "utf8",
);

const failures = [];

if (!tauriConfig.app?.security?.csp) {
  failures.push("Tauri CSP must not be null or empty.");
}

const permissions = JSON.stringify(capabilities.permissions ?? []);
if (permissions.includes("shell:allow-execute")) {
  failures.push("Desktop capabilities must not grant shell:allow-execute.");
}
if (permissions.includes('"$HOME/**"')) {
  failures.push("Desktop capabilities must not grant recursive $HOME access.");
}

const csp = tauriConfig.app?.security?.csp ?? "";
if (!csp.includes("proxy-http:") || !csp.includes("proxy-https:")) {
  failures.push(
    "Tauri CSP must use explicit proxy-http and proxy-https schemes.",
  );
}

const mobileHandler = tauriLib.match(
  /#\[cfg\(mobile\)\][\s\S]*?generate_handler!\[([\s\S]*?)\]\);/,
)?.[1];
if (!mobileHandler) {
  failures.push("A dedicated mobile invoke handler must be present.");
} else if (
  /skills::|mcp_stdio::|mcp_remote::|mcp_oauth::|local_agent::/.test(
    mobileHandler,
  )
) {
  failures.push(
    "Mobile invoke handler must not expose Skill scripts or desktop MCP commands.",
  );
}

if (
  !tauriLib.includes("local_agent::LocalAgentState::default()") ||
  !tauriLib.includes("local_agent::local_agent_start")
) {
  failures.push("Desktop local-agent state and commands must be registered.");
}

if (
  !localAgentBridge.includes("std::net::Ipv4Addr::LOCALHOST") ||
  !localAgentBridge.includes('strip_prefix("Bearer ")') ||
  !localAgentBridge.includes("MAX_REQUEST_BYTES") ||
  !localAgentBridge.includes("MAX_RESULT_BYTES")
) {
  failures.push(
    "Local-agent MCP must bind loopback, require bearer auth, and enforce payload budgets.",
  );
}

if (
  !localAgentProtocol.includes("command.env_clear()") ||
  !localAgentProtocol.includes("features.shell_tool=false") ||
  !localAgentProtocol.includes("features.hooks=false") ||
  !localAgentProtocol.includes("agents.enabled=false") ||
  !localAgentProtocol.includes('"--strict-mcp-config"') ||
  !localAgentProtocol.includes('"--setting-sources"') ||
  !localAgentProtocol.includes('"--no-chrome"') ||
  !localAgentProtocol.includes('"--strict-config"') ||
  !localAgentProtocol.includes('model_provider=\\"openai\\"') ||
  !localAgentProtocol.includes("validate_codex_effective_config") ||
  !localAgentProtocol.includes("validate_claude_init") ||
  !localAgentProtocol.includes("HANDSHAKE_TIMEOUT") ||
  !localAgentProtocol.includes("MAX_PROTOCOL_OUTPUT_BYTES") ||
  !localAgentProtocol.includes("MAX_PROTOCOL_EVENTS") ||
  !localAgentProtocol.includes("127.0.0.1,localhost,::1") ||
  !localAgentProtocol.includes("ProcessGroup::leader()") ||
  !localAgentProtocol.includes("JobObject")
) {
  failures.push(
    "Local-agent processes must use a minimal environment, disabled native execution, and process-tree containment.",
  );
}

if (
  !localAgent.includes("shutdown_gracefully") ||
  !localAgent.includes("local_agent_cancel_all") ||
  !localAgent.includes(
    "native search is not allowed in isolated execution modes",
  ) ||
  !localAgentProtocol.includes("SHUTDOWN_TIMEOUT") ||
  !localAgentBridge.includes("cancel_pending")
) {
  failures.push(
    "Local-agent cancellation must reject pending tools and clean up process trees with a bounded grace period.",
  );
}

const startRequest = localAgent.match(
  /pub struct LocalAgentStartRequest \{([\s\S]*?)\n\}/,
)?.[1];
if (
  !startRequest ||
  /\b(command|args|cwd|executable|environment)\s*:/.test(startRequest)
) {
  failures.push(
    "The local-agent start request must not accept executable, argv, cwd, or environment input from the webview.",
  );
}

if (
  !localAgent.includes('format!("{}.exe", provider.command_name())') ||
  !localAgent.includes("valid_executable_name")
) {
  failures.push(
    "Windows local-agent launchers must be restricted to provider-native .exe files.",
  );
}

if (!/developerSkillScriptsEnabled:\s*false/.test(settingsSystem)) {
  failures.push("Desktop Skill scripts must default to disabled.");
}

const streamIndex = skillImporter.indexOf('internalStream("uint8array")');
const zipPreflightIndex = skillImporter.indexOf(
  "assertSkillZipCentralDirectory(buffer, subpath)",
);
const jsZipLoadIndex = skillImporter.indexOf("JSZip.loadAsync(buffer)");
const trackerIndex = skillImporter.indexOf("budget.createFileTracker(path)");
const trackChunkIndex = skillImporter.indexOf(
  "tracker.trackChunk(chunk.byteLength)",
);
const bufferChunkIndex = skillImporter.indexOf("chunks.push(chunk)");
const pauseIndex = skillImporter.indexOf("stream.pause()");
const resumeIndex = skillImporter.indexOf(".resume()", streamIndex);
if (
  zipPreflightIndex < 0 ||
  jsZipLoadIndex < zipPreflightIndex ||
  streamIndex < 0 ||
  trackerIndex < streamIndex ||
  trackChunkIndex < trackerIndex ||
  bufferChunkIndex < trackChunkIndex ||
  pauseIndex < streamIndex ||
  skillImporter.includes('entry.file.async("uint8array")') ||
  resumeIndex < bufferChunkIndex
) {
  failures.push(
    "Skill ZIP metadata must be preflighted before JSZip, and chunks budgeted before buffering.",
  );
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`security: ${failure}`);
  process.exit(1);
}

console.log("Desktop security checks passed.");
