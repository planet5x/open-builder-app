// ============================================================================
//  ai-provider.ts
//  AI SDK Provider 工厂 —— 根据 apiType 创建对应的 AI SDK Provider 实例
// ============================================================================

import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { type LanguageModel, wrapLanguageModel, extractReasoningMiddleware } from "ai";
import type { ToolSet } from "ai";
import { resolveBaseURL } from "./provider-config";
import type { ApiType, ProviderConfig } from "./provider-config";
import type {
  OpenAILanguageModelChatOptions,
  OpenAILanguageModelResponsesOptions,
} from "@ai-sdk/openai";
import type { AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import type { GoogleLanguageModelOptions } from "@ai-sdk/google";

export { DEFAULT_BASE_URLS, fetchModelList, resolveBaseURL } from "./provider-config";
export type { ApiType, ProviderConfig } from "./provider-config";

// ─── URL Helpers ─────────────────────────────────────────────────────────────

/**
 * 从 baseURL 中提取 hostname 作为 provider name
 */
function getHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "custom";
  }
}

// ─── Provider Factory ────────────────────────────────────────────────────────

/**
 * 根据 apiType 创建对应的 AI SDK provider 实例并返回 LanguageModel
 */
export function getProviderModel(config: ProviderConfig): LanguageModel {
  const { apiType, apiBaseUrl, apiKey, model, headers } = config;
  const baseURL = resolveBaseURL(apiBaseUrl, apiType);

  let lm: LanguageModel;

  switch (apiType) {
    case "openai": {
      const provider = createOpenAI({
        apiKey,
        baseURL,
        headers,
      });
      lm = provider.responses(model);
      break;
    }

    case "anthropic": {
      const provider = createAnthropic({
        apiKey,
        baseURL,
        headers: {
          "anthropic-dangerous-direct-browser-access": "true",
          ...headers,
        },
      });
      lm = provider(model);
      break;
    }

    case "google": {
      const provider = createGoogleGenerativeAI({
        apiKey,
        baseURL,
        headers,
      });
      lm = provider(model);
      break;
    }

    case "openai-compatible":
    default: {
      const provider = createOpenAICompatible({
        name: getHostname(baseURL),
        baseURL,
        apiKey,
        headers,
      });
      lm = provider(model);
      break;
    }
  }

  // openai / anthropic / google 都有专用的 reasoning 通道，AI SDK 已直接解析。
  // 只为 openai-compatible 包装 <think> 提取中间件（兼容 DeepSeek 等会用 <think> 标签的厂商），
  // 避免对其他 provider 造成无谓开销和误把代码注释中的 <think> 当作 reasoning。
  if (apiType === "openai-compatible") {
    return wrapLanguageModel({
      model: lm,
      middleware: extractReasoningMiddleware({ tagName: "think" }),
    });
  }
  return lm;
}

// ─── Provider Options ────────────────────────────────────────────────────────

/**
 * 根据 apiType 构建 provider 专属的 reasoning/thinking 选项
 */
export function buildProviderOptions(
  apiType: ApiType,
  thinkingBudget: number,
): Record<string, Record<string, unknown>> {
  switch (apiType) {
    case "anthropic":
      return {
        anthropic: {
          thinking: { type: "enabled", budgetTokens: thinkingBudget },
        } satisfies AnthropicLanguageModelOptions,
      };

    case "openai":
      return {
        openai: {
          reasoningSummary: "detailed",
        } satisfies OpenAILanguageModelResponsesOptions,
      };

    case "google":
      return {
        google: {
          thinkingConfig: { thinkingLevel: "high", includeThoughts: true },
        } satisfies GoogleLanguageModelOptions,
      };

    case "openai-compatible":
    default:
      return {
        openai: {
          reasoningEffort: "high",
        } satisfies OpenAILanguageModelChatOptions,
      };
  }
}

// ─── Built-in Search Tools ──────────────────────────────────────────────────

export interface BuiltinSearchConfig {
  /** Provider-managed tools to merge into the ToolSet */
  tools?: ToolSet;
  /** Names of tools executed server-side — used to filter stream events */
  providerToolNames: string[];
}

/**
 * 根据 apiType 创建对应 provider 的内置搜索配置
 * 返回 null 表示该 provider 不支持内置搜索
 */
export function getBuiltinSearchConfig(
  config: ProviderConfig,
): BuiltinSearchConfig | null {
  const { apiType, apiBaseUrl, apiKey, headers } = config;
  const baseURL = resolveBaseURL(apiBaseUrl, apiType);

  switch (apiType) {
    case "openai": {
      const provider = createOpenAI({ apiKey, baseURL, headers });
      const tools: ToolSet = {
        web_search_preview: provider.tools.webSearch({
          searchContextSize: "high",
        }),
      };
      return { tools, providerToolNames: Object.keys(tools) };
    }

    case "anthropic": {
      const provider = createAnthropic({
        apiKey,
        baseURL,
        headers: {
          "anthropic-dangerous-direct-browser-access": "true",
          ...headers,
        },
      });
      const tools: ToolSet = {
        web_search: provider.tools.webSearch_20250305({
          maxUses: 10,
        }),
      };
      return { tools, providerToolNames: Object.keys(tools) };
    }

    case "google": {
      const provider = createGoogleGenerativeAI({
        apiKey,
        baseURL,
        headers,
      });
      const tools: ToolSet = {
        google_search: provider.tools.googleSearch({}),
      };
      return { tools, providerToolNames: Object.keys(tools) };
    }

    case "openai-compatible":
    default:
      return null;
  }
}
