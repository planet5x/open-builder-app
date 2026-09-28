import {
  DEFAULT_OPENAI_MODEL,
  type ApiType,
} from "../../lib/ai/provider-config";

export const SETTINGS_VERSION = 19;

export function migrateSettings(persisted: unknown, version: number): unknown {
  const state = persisted as Record<string, any>;
  if (version === 0 && state.ai?.apiUrl) {
    let baseUrl: string = state.ai.apiUrl;
    baseUrl = baseUrl.replace(/\/chat\/completions$/, "");
    state.ai.apiBaseUrl = baseUrl.replace(/\/+$/, "");
    delete state.ai.apiUrl;
  }
  if (version < 2) {
    if (!state.webSearch) state.webSearch = {};
    state.webSearch.engine = state.webSearch.tavilyApiKey
      ? "tavily"
      : "disabled";
    state.webSearch.firecrawlApiKey = "";
  }
  if (version < 3) {
    if (!state.assetSearch) {
      state.assetSearch = {
        engine: "disabled",
        pixabayApiKey: "",
        unsplashApiKey: "",
      };
    }
  }
  if (version < 4) {
    if (!state.ai) state.ai = {};
    if (!state.ai.apiType) {
      state.ai.apiType = "openai-compatible";
    }
  }
  if (version < 5) {
    if (!state.system) state.system = {};
    if (state.system.reverseProxy === undefined) {
      state.system.reverseProxy = false;
    }
    if (state.system.reverseProxyAllowedHosts === undefined) {
      state.system.reverseProxyAllowedHosts = "";
    }
  }
  if (version < 8) {
    if (!state.system) state.system = {};
    if (state.system.planModeEnabled === undefined) {
      state.system.planModeEnabled = false;
    }
  }
  if (version < 10) {
    if (!state.system) state.system = {};
    if (state.system.reverseProxyAllowedHosts === undefined) {
      state.system.reverseProxyAllowedHosts = "";
    }
  }
  if (version < 11) {
    if (!state.system) state.system = {};
    if (state.system.autoQaEnabled === undefined) {
      state.system.autoQaEnabled = false;
    }
  }
  if (version < 12) {
    if (state.webSearch?.engine === "server") {
      state.webSearch.engine = "disabled";
    }
    if (state.webSearch) delete state.webSearch.backendProvider;

    if (state.assetSearch?.engine === "server") {
      state.assetSearch.engine = "disabled";
    }
    if (state.assetSearch) delete state.assetSearch.backendProvider;

    delete state.serverService;
    delete state.serverServiceCache;
    delete state.modelCache;
  }
  if (version < 14) {
    if (state.webSearch) {
      delete state.webSearch.tavilyApiUrl;
      delete state.webSearch.firecrawlApiUrl;
    }
    if (state.assetSearch) {
      delete state.assetSearch.pixabayApiUrl;
      delete state.assetSearch.unsplashApiUrl;
    }
  }
  if (version < 15) {
    if (!state.system) state.system = {};
    state.system.developerSkillScriptsEnabled = false;
  }
  if (version < 16) {
    if (!state.ai) state.ai = {};
    state.ai.runtime = state.ai.runtime === "localCli" ? "localCli" : "api";
    const localAgent = state.ai.localAgent ?? {};
    state.ai.localAgent = {
      provider: localAgent.provider === "claude" ? "claude" : "codex",
      codex: {
        model:
          typeof localAgent.codex?.model === "string"
            ? localAgent.codex.model
            : "",
        effort:
          typeof localAgent.codex?.effort === "string"
            ? localAgent.codex.effort
            : "",
      },
      claude: {
        model:
          typeof localAgent.claude?.model === "string"
            ? localAgent.claude.model
            : "",
        effort:
          typeof localAgent.claude?.effort === "string"
            ? localAgent.claude.effort
            : "",
      },
    };
  }
  if (version < 17) {
    if (!state.ai) state.ai = {};
    const apiType = state.ai.apiType as ApiType | undefined;
    if (
      (apiType === "openai" || apiType === "openai-compatible") &&
      (typeof state.ai.model !== "string" || !state.ai.model.trim())
    ) {
      state.ai.model = DEFAULT_OPENAI_MODEL;
    }
  }
  if (version < 18) {
    if (!state.system) state.system = {};
    if (typeof state.system.customSystemPrompt !== "string") {
      state.system.customSystemPrompt = "";
    }
  }
  if (version < 19) {
    if (!state.webSearch) state.webSearch = {};
    if (typeof state.webSearch.exaApiKey !== "string") {
      state.webSearch.exaApiKey = "";
    }
  }
  return state;
}
