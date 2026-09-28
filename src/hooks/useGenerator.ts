import { useRef, useCallback, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ToolSet } from "ai";
import type {
  GenerateResult,
  GenerationBackend,
  GeneratorEvents,
} from "../lib/ai/generator";
import { useConversationStore } from "../store/conversation";
import { useSettingsStore } from "../store/settings";
import { useInteractiveStore } from "../store/interactive";
import { useSubagentStore } from "../store/subagent";
import { useSandpackStore } from "../store/sandpack";
import { filterMemoryMessages } from "../lib/utils/memory-filter";
import { createSnapshotForCurrentState } from "../lib/utils/snapshot-helpers";
import type {
  Message,
  Conversation,
  ProjectFiles,
  AISettings,
  WebSearchSettings,
  AssetSearchSettings,
  Attachment,
  GeneratorRunState,
  StructuredGenerationError,
} from "../types";
import { useMemoryStore } from "../store/memory";
import { useFileOperations } from "./useFileOperations";
import { useTitleAndCompression } from "./useTitleAndCompression";
import {
  classifyGenerationError,
  formatGenerationErrorMessage,
} from "../lib/ai/generation-error";
import {
  findPendingToolCall,
  isGenerationRunCurrent,
  isGeneratorConstructionCurrent,
} from "../lib/ai/run-guard";
import { getT } from "../i18n";
import type { McpRuntimeBundle } from "../lib/mcp/runtime";
import type { ExecutionMode, RuntimePlatform } from "../lib/ai/tools-schema";
import { TOOL_POLICY_VERSION } from "../lib/ai/tool-policy-version";
import { getSkillRegistry } from "../lib/skills/instance";
import {
  hydrateMessageAttachments,
  resolveAttachmentsForModel,
  toAttachmentRef,
} from "../lib/attachments/store";
import { recordPermissionActivity } from "../lib/security/activity-log";
import {
  sanitizeToolExecutionOutputForHistory,
  sanitizeToolResultForHistory,
  serializeToolArgumentsForHistory,
} from "../lib/utils/message-security";
import {
  isErrorMessage,
  messagesForConversationContinuation,
  removeErrorMessages,
} from "../lib/ai/conversation-context";
import { PLAN_MODE_SYSTEM_SUFFIX } from "../lib/ai/plan-mode";
import { buildRunSystemPromptSuffix } from "../lib/ai/run-system-prompt";
import { buildCustomSystemPromptSection } from "../lib/ai/custom-system-prompt";
import { appendBufferedAssistantOutput } from "../lib/utils/stream-output";

interface GeneratorConfigSnapshot {
  runtime: AISettings["runtime"];
  localProvider: AISettings["localAgent"]["provider"];
  localModel: string;
  localEffort: string;
  apiType: AISettings["apiType"];
  apiKey: string;
  apiBaseUrl: string;
  model: string;
  searchEngine: string;
  tavilyKey: string;
  firecrawlKey: string;
  exaKey: string;
  assetEngine: string;
  pixabayKey: string;
  unsplashKey: string;
  toolPolicyVersion: string;
  developerSkillScriptsEnabled: boolean;
}

function buildGeneratorConfigSnapshot(
  ai: AISettings,
  webSearch: WebSearchSettings,
  assetSearch: AssetSearchSettings,
  developerSkillScriptsEnabled: boolean,
): GeneratorConfigSnapshot {
  const localProvider = ai.localAgent.provider;
  const localPreferences = ai.localAgent[localProvider];
  return {
    runtime: ai.runtime,
    localProvider,
    localModel: localPreferences.model,
    localEffort: localPreferences.effort,
    apiType: ai.apiType,
    apiKey: ai.apiKey,
    apiBaseUrl: ai.apiBaseUrl,
    model: ai.model,
    searchEngine: webSearch.engine,
    tavilyKey: webSearch.tavilyApiKey,
    firecrawlKey: webSearch.firecrawlApiKey,
    exaKey: webSearch.exaApiKey,
    assetEngine: assetSearch.engine,
    pixabayKey: assetSearch.pixabayApiKey,
    unsplashKey: assetSearch.unsplashApiKey,
    toolPolicyVersion: TOOL_POLICY_VERSION,
    developerSkillScriptsEnabled,
  };
}

function currentGeneratorConfigSnapshot(): GeneratorConfigSnapshot {
  const state = useSettingsStore.getState();
  return buildGeneratorConfigSnapshot(
    state.ai,
    state.webSearch,
    state.assetSearch,
    state.system.developerSkillScriptsEnabled,
  );
}

function sameGeneratorConfig(
  a: GeneratorConfigSnapshot | null,
  b: GeneratorConfigSnapshot,
): boolean {
  if (!a) return false;
  return (
    a.apiType === b.apiType &&
    a.runtime === b.runtime &&
    a.localProvider === b.localProvider &&
    a.localModel === b.localModel &&
    a.localEffort === b.localEffort &&
    a.apiKey === b.apiKey &&
    a.apiBaseUrl === b.apiBaseUrl &&
    a.model === b.model &&
    a.searchEngine === b.searchEngine &&
    a.tavilyKey === b.tavilyKey &&
    a.firecrawlKey === b.firecrawlKey &&
    a.exaKey === b.exaKey &&
    a.assetEngine === b.assetEngine &&
    a.pixabayKey === b.pixabayKey &&
    a.unsplashKey === b.unsplashKey &&
    a.toolPolicyVersion === b.toolPolicyVersion &&
    a.developerSkillScriptsEnabled === b.developerSkillScriptsEnabled
  );
}

function getLastForcedSkillIds(messages: readonly Message[]): string[] {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === "user" && message.metadata?.origin !== "auto_qa") {
      return message.forcedSkillIds ?? [];
    }
  }
  return [];
}

/** Apply compression and hydrate attachment references only for model input. */
async function getMessagesForAPI(conv: Conversation): Promise<Message[]> {
  return hydrateMessageAttachments(messagesForConversationContinuation(conv));
}

const AUTO_QA_PROMPT =
  "Automatic QA round: call project_health_check with include_console=true. " +
  "Fix issues that break the build or runtime, using the file tools. " +
  "No redesigns, no optional refactors. If only informational issues remain, summarize them and stop.";

interface GenerateRunOptions {
  skipAutoQa?: boolean;
  forcedSkillIds?: string[];
}

interface GeneratorRuntime {
  createOpenAIGenerator: typeof import("../lib/ai/client").createOpenAIGenerator;
  buildToolHandlers: typeof import("../lib/tools/handler-factory").buildToolHandlers;
  createSubagentDispatcher: typeof import("../lib/ai/subagents/runner").createSubagentDispatcher;
  runCompress: typeof import("../lib/utils/run-compress").runCompress;
  buildMemoryPromptSection: typeof import("../lib/tools/memory").buildMemoryPromptSection;
  buildSkillsPromptSection: typeof import("../lib/skills/tool-handler").buildSkillsPromptSection;
  buildForcedSkillsPromptSection: typeof import("../lib/skills/tool-handler").buildForcedSkillsPromptSection;
  getSkillRegistry: typeof import("../lib/skills/instance").getSkillRegistry;
  isSkillsAvailable: typeof import("../lib/skills/fs").isSkillsAvailable;
  mcpManager: ReturnType<
    typeof import("../lib/mcp/connection-manager").getMcpConnectionManager
  >;
  buildToolSet: (args: {
    custom: ToolSet;
    planMode: boolean;
    mode?: ExecutionMode;
    runtimePlatform: RuntimePlatform;
    allowedDynamicNames?: ReadonlySet<string>;
  }) => ToolSet;
}

let generatorRuntimePromise: Promise<GeneratorRuntime> | null = null;

function loadGeneratorRuntime(): Promise<GeneratorRuntime> {
  generatorRuntimePromise ??= Promise.all([
    import("../lib/ai/client"),
    import("../lib/ai/tools-schema"),
    import("../lib/tools/memory"),
    import("../lib/tools/handler-factory"),
    import("../lib/ai/subagents/runner"),
    import("../lib/utils/run-compress"),
    import("../lib/skills/tool-handler"),
    import("../lib/skills/fs"),
    import("../lib/mcp/connection-manager"),
  ]).then(
    ([
      client,
      toolsSchema,
      memory,
      handlerFactory,
      subagentRunner,
      runCompressModule,
      skillToolHandler,
      skillFs,
      mcpConnectionManager,
    ]) => {
      const buildToolSet = ({
        custom,
        planMode,
        mode = planMode ? "plan" : "chat",
        runtimePlatform,
        allowedDynamicNames = new Set(),
      }: {
        custom: ToolSet;
        planMode: boolean;
        mode?: ExecutionMode;
        runtimePlatform: RuntimePlatform;
        allowedDynamicNames?: ReadonlySet<string>;
      }): ToolSet =>
        toolsSchema.buildToolSetForRun({
          custom,
          mode,
          platform: runtimePlatform,
          allowedDynamicNames,
        });

      return {
        createOpenAIGenerator: client.createOpenAIGenerator,
        buildToolHandlers: handlerFactory.buildToolHandlers,
        createSubagentDispatcher: subagentRunner.createSubagentDispatcher,
        runCompress: runCompressModule.runCompress,
        buildMemoryPromptSection: memory.buildMemoryPromptSection,
        buildSkillsPromptSection: skillToolHandler.buildSkillsPromptSection,
        buildForcedSkillsPromptSection:
          skillToolHandler.buildForcedSkillsPromptSection,
        getSkillRegistry,
        isSkillsAvailable: skillFs.isSkillsAvailable,
        mcpManager: mcpConnectionManager.getMcpConnectionManager(),
        buildToolSet,
      };
    },
  );
  return generatorRuntimePromise;
}

interface UseGeneratorOptions {
  settings: AISettings;
  webSearchSettings: WebSearchSettings;
  assetSearchSettings: AssetSearchSettings;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setFiles: Dispatch<SetStateAction<ProjectFiles>>;
  setIsGenerating: Dispatch<SetStateAction<boolean>>;
  setTemplate: Dispatch<SetStateAction<string>>;
  restartSandpack: () => void;
}

export function useGenerator({
  settings,
  webSearchSettings,
  assetSearchSettings,
  setMessages,
  setFiles,
  setIsGenerating,
  setTemplate,
  restartSandpack,
}: UseGeneratorOptions) {
  const generatorRef = useRef<GenerationBackend | null>(null);
  const [runState, setRunState] = useState<GeneratorRunState>("idle");
  const [lastError, setLastError] = useState<StructuredGenerationError | null>(
    null,
  );
  const [isThinkingStreaming, setIsThinkingStreaming] = useState(false);
  const generatorConfigRef = useRef<GeneratorConfigSnapshot | null>(null);
  const generatorConstructionEpochRef = useRef(0);
  const activeId = useConversationStore((s) => s.activeId);
  const prevActiveIdRef = useRef(activeId);
  const textBufferRef = useRef("");
  const thinkingBufferRef = useRef("");
  const typewriterTimerRef = useRef<number | null>(null);
  const thinkingTimerRef = useRef<number | null>(null);
  const lastCharTimeRef = useRef(0);
  const lastThinkingTimeRef = useRef(0);
  const runConversationIdRef = useRef<string | null>(null);
  const forcedSkillsPromptRef = useRef("");
  const customSystemPromptRef = useRef("");
  const requestPromptContextRef = useRef("");
  const baseCustomToolSetRef = useRef<ToolSet>({});
  const mcpRuntimeRef = useRef<McpRuntimeBundle | null>(null);

  const clearOutputBuffers = useCallback(() => {
    if (typewriterTimerRef.current) {
      cancelAnimationFrame(typewriterTimerRef.current);
      typewriterTimerRef.current = null;
    }
    if (thinkingTimerRef.current) {
      cancelAnimationFrame(thinkingTimerRef.current);
      thinkingTimerRef.current = null;
    }
    textBufferRef.current = "";
    thinkingBufferRef.current = "";
  }, []);

  const isCurrentGeneratorRun = useCallback(
    (runConversationId: string | null) =>
      isGenerationRunCurrent(
        runConversationId,
        useConversationStore.getState().activeId,
        runConversationIdRef.current,
      ),
    [],
  );

  useEffect(
    () => () => {
      generatorConstructionEpochRef.current += 1;
      clearOutputBuffers();
      forcedSkillsPromptRef.current = "";
      customSystemPromptRef.current = "";
      requestPromptContextRef.current = "";
      mcpRuntimeRef.current = null;
      generatorRef.current?.abort();
    },
    [clearOutputBuffers],
  );

  const invalidateGenerator = useCallback(() => {
    generatorConstructionEpochRef.current += 1;
    generatorRef.current?.abort();
    generatorRef.current = null;
    generatorConfigRef.current = null;
    runConversationIdRef.current = null;
    forcedSkillsPromptRef.current = "";
    customSystemPromptRef.current = "";
    requestPromptContextRef.current = "";
    baseCustomToolSetRef.current = {};
    mcpRuntimeRef.current = null;
    clearOutputBuffers();
    setIsThinkingStreaming(false);
    useInteractiveStore.getState().rejectAllPending("project reset");
    useSubagentStore.setState({ progress: {} });
  }, [clearOutputBuffers]);

  useEffect(() => {
    if (prevActiveIdRef.current === activeId) return;
    generatorConstructionEpochRef.current += 1;
    generatorRef.current?.abort();
    generatorRef.current = null;
    generatorConfigRef.current = null;
    runConversationIdRef.current = null;
    forcedSkillsPromptRef.current = "";
    customSystemPromptRef.current = "";
    requestPromptContextRef.current = "";
    baseCustomToolSetRef.current = {};
    mcpRuntimeRef.current = null;
    clearOutputBuffers();
    prevActiveIdRef.current = activeId;
    useInteractiveStore.getState().rejectAllPending("conversation switched");
    useSubagentStore.setState({ progress: {} });
    setIsGenerating(false);
    setIsThinkingStreaming(false);
    setRunState("idle");
  }, [activeId, clearOutputBuffers, setIsGenerating]);

  const { updateFiles, deleteFile, renameFile, moveFile } = useFileOperations({
    setFiles,
    generatorRef,
  });

  const resolveEffectiveConfig = useCallback(async () => {
    return {
      apiType: settings.apiType,
      apiBaseUrl: settings.apiBaseUrl,
      apiKey: settings.apiKey,
      model: settings.model,
    };
  }, [settings]);

  const generateLocalUtilityText = useCallback(
    async (instructions: string, prompt: string) => {
      const provider = settings.localAgent.provider;
      const preferences = settings.localAgent[provider];
      const { runLocalUtilityText } =
        await import("../lib/local-agent/generator");
      return runLocalUtilityText(
        {
          provider,
          model: preferences.model,
          effort: preferences.effort,
        },
        instructions,
        prompt,
      );
    },
    [settings.localAgent],
  );

  const { triggerSmartTitle, compressContext } = useTitleAndCompression({
    resolveConfig: resolveEffectiveConfig,
    setIsGenerating,
    setMessages,
    generateTextOverride:
      settings.runtime === "localCli" ? generateLocalUtilityText : undefined,
  });

  /** Flush all remaining thinking buffer content at once */
  const flushThinkingBuffer = useCallback(() => {
    if (thinkingTimerRef.current) {
      cancelAnimationFrame(thinkingTimerRef.current);
      thinkingTimerRef.current = null;
    }
    if (thinkingBufferRef.current) {
      const remaining = thinkingBufferRef.current;
      thinkingBufferRef.current = "";
      setMessages((prev) =>
        appendBufferedAssistantOutput(prev, { thinking: remaining }),
      );
    }
  }, [setMessages]);

  const flushOutputBuffers = useCallback(() => {
    if (thinkingTimerRef.current) {
      cancelAnimationFrame(thinkingTimerRef.current);
      thinkingTimerRef.current = null;
    }
    if (typewriterTimerRef.current) {
      cancelAnimationFrame(typewriterTimerRef.current);
      typewriterTimerRef.current = null;
    }
    const thinking = thinkingBufferRef.current;
    const text = textBufferRef.current;
    thinkingBufferRef.current = "";
    textBufferRef.current = "";
    if (!thinking && !text) return;
    setMessages((prev) =>
      appendBufferedAssistantOutput(prev, { thinking, text }),
    );
  }, [setMessages]);

  const appendGenerationError = useCallback(
    (
      err: unknown,
      options: { replaceExisting?: boolean } = {},
    ): StructuredGenerationError => {
      flushOutputBuffers();
      setIsThinkingStreaming(false);
      const classified = classifyGenerationError(err);
      setLastError(classified);
      setRunState(classified.kind === "aborted" ? "aborted" : "error");
      setMessages((prev) => [
        ...(options.replaceExisting ? removeErrorMessages(prev) : prev),
        {
          role: "assistant",
          content: formatGenerationErrorMessage(classified, getT()),
          isError: true,
          errorKind: classified.kind,
          errorRetryable: classified.retryable,
          ...(classified.status !== undefined
            ? { errorStatus: classified.status }
            : {}),
        },
      ]);
      return classified;
    },
    [flushOutputBuffers, setMessages],
  );

  const getGenerator = useCallback(async () => {
    const isLocalRuntime = settings.runtime === "localCli";
    const localProvider = settings.localAgent.provider;
    const localPreferences = settings.localAgent[localProvider];
    const currentApiType = settings.apiType;
    const currentApiKey = settings.apiKey;
    const currentApiBaseUrl = settings.apiBaseUrl;
    const currentModel = settings.model;

    if (
      !isLocalRuntime &&
      (!settings.apiKey || !settings.apiBaseUrl || !settings.model)
    )
      return null;
    if (isLocalRuntime) {
      const { supportsLocalAgents } = await import("../lib/local-agent/tauri");
      if (!(await supportsLocalAgents())) {
        throw new Error(
          "Local CLI agents are available only in the desktop application. Switch the runtime back to API.",
        );
      }
    }

    const currentActiveId = useConversationStore.getState().activeId;
    if (!currentActiveId) return null;

    // Invalidate on conversation switch, including a store update that arrived
    // before React committed the matching render.
    if (prevActiveIdRef.current !== currentActiveId) {
      generatorConstructionEpochRef.current += 1;
      generatorRef.current?.abort();
      generatorRef.current = null;
      generatorConfigRef.current = null;
      runConversationIdRef.current = null;
      baseCustomToolSetRef.current = {};
      mcpRuntimeRef.current = null;
      clearOutputBuffers();
      setIsThinkingStreaming(false);
      prevActiveIdRef.current = currentActiveId;
      useInteractiveStore.getState().rejectAllPending("conversation switched");
      useSubagentStore.setState({ progress: {} });
    }

    const nextConfig = buildGeneratorConfigSnapshot(
      settings,
      webSearchSettings,
      assetSearchSettings,
      useSettingsStore.getState().system.developerSkillScriptsEnabled,
    );

    if (
      generatorRef.current &&
      !sameGeneratorConfig(generatorConfigRef.current, nextConfig)
    ) {
      generatorConstructionEpochRef.current += 1;
      generatorRef.current.abort();
      generatorRef.current = null;
      generatorConfigRef.current = null;
      baseCustomToolSetRef.current = {};
      mcpRuntimeRef.current = null;
    }

    if (!generatorRef.current) {
      const constructionEpoch = ++generatorConstructionEpochRef.current;
      const runtime = await loadGeneratorRuntime();
      const generatorConversationId = currentActiveId;
      const isBuiltinSearch =
        !isLocalRuntime && webSearchSettings.engine === "builtin";
      const webConfigured =
        webSearchSettings.engine !== "builtin" &&
        useSettingsStore.getState().isWebSearchConfigured();
      const assetConfigured = useSettingsStore
        .getState()
        .isAssetSearchConfigured();

      const {
        customToolSet,
        combinedToolHandler,
        providerToolNames,
        runtimePlatform,
      } = await runtime.buildToolHandlers({
        features: {
          builtinSearch: isBuiltinSearch,
          webSearch: webConfigured,
          assetSearch: assetConfigured,
          localAgent: isLocalRuntime,
        },
        effectiveWebSearchSettings: webSearchSettings,
        effectiveAssetSearchSettings: assetSearchSettings,
        apiConfig: {
          apiType: currentApiType,
          apiBaseUrl: currentApiBaseUrl,
          apiKey: currentApiKey,
          model: currentModel,
        },
        getConsoleLogs: () => useSandpackStore.getState().consoleLogs,
        memoryDeps: {
          getAll: () => useMemoryStore.getState().getAll(),
          processBatch: (ops) => useMemoryStore.getState().processBatch(ops),
        },
        developerSkillScriptsEnabled:
          useSettingsStore.getState().system.developerSkillScriptsEnabled,
        requestRegistryOriginApproval: async (origin, context) => {
          if (!isCurrentGeneratorRun(generatorConversationId)) return false;
          const translations = getT();
          recordPermissionActivity({
            conversationId: context.run.conversationId,
            tool: "install_component",
            source: "registry",
            mode: context.run.mode,
            platform: context.run.platform,
            decision: "requested",
            target: origin,
          });
          const answers = await useInteractiveStore.getState().askQuestion({
            toolCallId: context.toolCallId,
            presentation: "approval",
            questions: [
              {
                header: translations.approvals.registryHeader,
                question: translations.approvals.registryQuestion.replace(
                  "{origin}",
                  origin,
                ),
                multiSelect: false,
                options: [
                  {
                    label: translations.approvals.approveOnce,
                    description: translations.approvals.approveOnceDesc,
                  },
                  {
                    label: translations.approvals.deny,
                    description: translations.approvals.denyDesc,
                  },
                ],
              },
            ],
          });
          const approved = answers.answers[0]?.selected.includes(
            translations.approvals.approveOnce,
          );
          recordPermissionActivity({
            conversationId: context.run.conversationId,
            tool: "install_component",
            source: "registry",
            mode: context.run.mode,
            platform: context.run.platform,
            decision: approved ? "allowed" : "denied",
            target: origin,
            reason: approved ? undefined : "user denied custom registry origin",
          });
          return approved;
        },
        filesBridge: {
          getFiles: () =>
            isCurrentGeneratorRun(generatorConversationId)
              ? (generatorRef.current?.getFiles() ?? {})
              : {},
          onFilesChanged: (newFiles, changes) => {
            if (!isCurrentGeneratorRun(generatorConversationId)) return;
            generatorRef.current?.setFiles(newFiles);
            setFiles(newFiles);
            const depsChanged = changes.some(
              (c) =>
                c.path === "package.json" || c.path.endsWith("/package.json"),
            );
            if (depsChanged) restartSandpack();
          },
        },
      });

      const combinedToolHandlerWithMcp: typeof combinedToolHandler = async (
        name,
        args,
        context,
      ) => {
        const mcpRuntime = mcpRuntimeRef.current;
        if (mcpRuntime?.aliases.has(name)) {
          return mcpRuntime.handler(name, args, context);
        }
        return combinedToolHandler(name, args, context);
      };

      const dispatchSubagent = runtime.createSubagentDispatcher({
        getApiConfig: () => ({
          apiType: currentApiType,
          apiBaseUrl: currentApiBaseUrl,
          apiKey: currentApiKey,
          model: currentModel,
        }),
        getCustomToolSet: () =>
          generatorRef.current?.getCustomToolSet() ?? customToolSet,
        getCombinedToolHandler: () => combinedToolHandlerWithMcp,
        getCustomSystemPrompt: () => customSystemPromptRef.current,
        getForcedSkillsPrompt: () => forcedSkillsPromptRef.current,
        getSkillContextSnapshot: () =>
          generatorRef.current?.getSkillContext().snapshot() ?? null,
        getAdditionalToolNames: () =>
          mcpRuntimeRef.current?.subagentToolNames ?? new Set(),
        createGenerator: isLocalRuntime
          ? async (options, events) => {
              const { createLocalAgentGenerator } =
                await import("../lib/local-agent/generator");
              return createLocalAgentGenerator(
                {
                  provider: localProvider,
                  model: localPreferences.model,
                  effort: localPreferences.effort,
                  nativeSearch: false,
                  conversationId: options.conversationId,
                },
                events,
                options.initialFiles,
                options.customTools,
                options.customToolHandler,
                {
                  conversationId: options.conversationId,
                  tools: options.tools,
                  executionMode: options.executionMode,
                  runtimePlatform: options.runtimePlatform,
                  allowedMcpAliases: options.allowedMcpAliases,
                  initialSkillContext: options.initialSkillContext,
                  systemPrompt: options.systemPrompt,
                  maxIterations: options.maxIterations,
                },
              );
            }
          : undefined,
      });

      const initialPlanMode =
        useSettingsStore.getState().system.planModeEnabled;
      const initialTools = runtime.buildToolSet({
        custom: customToolSet,
        planMode: initialPlanMode,
        runtimePlatform,
      });

      const initialFiles =
        (generatorConversationId &&
          useConversationStore.getState().conversations[generatorConversationId]
            ?.files) ||
        {};

      const generatorEvents = {
        onText: (delta) => {
          if (!isCurrentGeneratorRun(generatorConversationId)) return;
          setRunState("streaming");
          setIsThinkingStreaming(false);
          flushThinkingBuffer();
          textBufferRef.current += delta;
          if (!typewriterTimerRef.current) {
            const typeChar = (timestamp: number) => {
              typewriterTimerRef.current = null;
              if (!isCurrentGeneratorRun(generatorConversationId)) {
                textBufferRef.current = "";
                return;
              }
              if (timestamp - lastCharTimeRef.current >= 20) {
                if (textBufferRef.current.length > 0) {
                  const char = textBufferRef.current[0];
                  textBufferRef.current = textBufferRef.current.slice(1);
                  setMessages((prev) => {
                    const last = prev[prev.length - 1];
                    if (last?.role === "assistant") {
                      return [
                        ...prev.slice(0, -1),
                        {
                          ...last,
                          content:
                            ((typeof last.content === "string"
                              ? last.content
                              : "") || "") + char,
                        },
                      ];
                    }
                    return [...prev, { role: "assistant", content: char }];
                  });
                  lastCharTimeRef.current = timestamp;
                }
              }
              if (textBufferRef.current.length > 0) {
                typewriterTimerRef.current = requestAnimationFrame(typeChar);
              }
            };
            typewriterTimerRef.current = requestAnimationFrame(typeChar);
          }
        },
        onThinking: (delta) => {
          if (!isCurrentGeneratorRun(generatorConversationId)) return;
          setRunState("streaming");
          setIsThinkingStreaming(true);
          thinkingBufferRef.current += delta;
          if (!thinkingTimerRef.current) {
            const typeThinking = (timestamp: number) => {
              thinkingTimerRef.current = null;
              if (!isCurrentGeneratorRun(generatorConversationId)) {
                thinkingBufferRef.current = "";
                return;
              }
              if (timestamp - lastThinkingTimeRef.current >= 20) {
                if (thinkingBufferRef.current.length > 0) {
                  const char = thinkingBufferRef.current[0];
                  thinkingBufferRef.current =
                    thinkingBufferRef.current.slice(1);
                  setMessages((prev) => {
                    const last = prev[prev.length - 1];
                    if (last?.role === "assistant") {
                      return [
                        ...prev.slice(0, -1),
                        { ...last, thinking: (last.thinking || "") + char },
                      ];
                    }
                    return [
                      ...prev,
                      { role: "assistant", content: null, thinking: char },
                    ];
                  });
                  lastThinkingTimeRef.current = timestamp;
                }
              }
              if (thinkingBufferRef.current.length > 0) {
                thinkingTimerRef.current = requestAnimationFrame(typeThinking);
              }
            };
            thinkingTimerRef.current = requestAnimationFrame(typeThinking);
          }
        },
        onToolCall: (name, id) => {
          if (!isCurrentGeneratorRun(generatorConversationId)) return;
          setIsThinkingStreaming(false);
          setRunState(
            name === "ask_user_question"
              ? "waitingUser"
              : name === "exit_plan_mode"
                ? "awaitingPlanApproval"
                : "executingTool",
          );
          flushOutputBuffers();

          const actualId =
            id || `call_${Math.random().toString(36).substring(2, 11)}`;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            const newToolCall = {
              id: actualId,
              type: "function" as const,
              function: { name, arguments: "" },
            };
            if (last?.role === "assistant") {
              if (last.tool_calls?.some((tc) => tc.id === actualId))
                return prev;
              return [
                ...prev.slice(0, -1),
                {
                  ...last,
                  tool_calls: [...(last.tool_calls || []), newToolCall],
                },
              ];
            }
            return [
              ...prev,
              {
                role: "assistant" as const,
                content: null,
                tool_calls: [newToolCall],
              },
            ];
          });
        },
        onToolResult: (_name, _args, result, _toolCallId, output) => {
          if (!isCurrentGeneratorRun(generatorConversationId)) return;
          const persistedArguments = serializeToolArgumentsForHistory(
            _name,
            _args,
          );
          const persistedResult = sanitizeToolResultForHistory(
            _name,
            _args,
            result,
          );
          const persistedOutput = sanitizeToolExecutionOutputForHistory(
            _name,
            _args,
            output,
          );
          setMessages((prev) => {
            const msgs = [...prev];
            const target = findPendingToolCall(msgs, _toolCallId);
            if (target) {
              const { messageIndex, toolCallIndex } = target;
              const toolCall = msgs[messageIndex].tool_calls![toolCallIndex];
              const updatedToolCalls = [...msgs[messageIndex].tool_calls!];
              updatedToolCalls[toolCallIndex] = {
                ...toolCall,
                function: {
                  ...toolCall.function,
                  arguments: persistedArguments,
                },
              };
              msgs[messageIndex] = {
                ...msgs[messageIndex],
                tool_calls: updatedToolCalls,
              };
              return [
                ...msgs,
                {
                  role: "tool",
                  content: persistedResult,
                  tool_call_id: toolCall.id,
                  ...(persistedOutput ? { toolOutput: persistedOutput } : {}),
                },
              ];
            }
            console.warn("Couldn't find matching tool call for result:", _name);
            return prev;
          });
        },
        onFileChange: (newFiles) => {
          if (!isCurrentGeneratorRun(generatorConversationId)) return;
          setFiles(newFiles);
        },
        onTemplateChange: (tmpl, newFiles) => {
          if (!isCurrentGeneratorRun(generatorConversationId)) return;
          setTemplate(tmpl);
          setFiles(newFiles);
          restartSandpack();
        },
        onDependenciesChange: (newFiles) => {
          if (!isCurrentGeneratorRun(generatorConversationId)) return;
          setFiles(newFiles);
          restartSandpack();
        },
        onComplete: () => {
          if (!isCurrentGeneratorRun(generatorConversationId)) return;
          setIsThinkingStreaming(false);
          setRunState("completed");
          flushOutputBuffers();
          createSnapshotForCurrentState();
        },
        onError: (error) => {
          if (!isCurrentGeneratorRun(generatorConversationId)) return;
          setIsThinkingStreaming(false);
          setLastError(classifyGenerationError(error));
          setRunState("error");
          console.error("Generation error:", error);
        },
        onRetry: (attempt, maxAttempts, error) => {
          if (!isCurrentGeneratorRun(generatorConversationId)) return;
          setIsThinkingStreaming(false);
          clearOutputBuffers();
          console.warn(
            `Retrying API request (${attempt}/${maxAttempts}):`,
            error.message,
          );
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant") {
              return prev.slice(0, -1);
            }
            return prev;
          });
        },
        onCompact: async () => {
          if (!isCurrentGeneratorRun(generatorConversationId)) return null;
          const s = useConversationStore.getState();
          const conv = generatorConversationId
            ? s.conversations[generatorConversationId]
            : null;
          if (!conv) return null;

          const result = await runtime.runCompress(
            {
              apiType: settings.apiType,
              apiBaseUrl: settings.apiBaseUrl,
              apiKey: settings.apiKey,
              model: settings.model,
            },
            conv,
            isLocalRuntime ? generateLocalUtilityText : undefined,
          );
          if (!isCurrentGeneratorRun(generatorConversationId)) return null;
          if (!result) return null;
          return getMessagesForAPI({ ...conv, compressedContext: result });
        },
      } satisfies GeneratorEvents;
      const generatorExtras = {
        conversationId: generatorConversationId,
        tools: initialTools,
        askUserQuestion: (toolCallId, questions) => {
          if (!isCurrentGeneratorRun(generatorConversationId)) {
            return Promise.reject(
              new DOMException("conversation switched", "AbortError"),
            );
          }
          return useInteractiveStore.getState().askQuestion({
            toolCallId,
            questions,
          });
        },
        requestPlanApproval: (toolCallId, plan) => {
          if (!isCurrentGeneratorRun(generatorConversationId)) {
            return Promise.reject(
              new DOMException("conversation switched", "AbortError"),
            );
          }
          return useInteractiveStore.getState().askPlanApproval({
            toolCallId,
            plan,
          });
        },
        onPlanApproved: async () => {
          if (!isCurrentGeneratorRun(generatorConversationId)) return;
          const { system, setSystem } = useSettingsStore.getState();
          if (system.planModeEnabled) {
            setSystem({ ...system, planModeEnabled: false });
          }
          generatorRef.current?.setReadOnlyMode(false);
          generatorRef.current?.setExecutionMode("chat");
          const mcpRuntime = await runtime.mcpManager.prepareRuntime();
          if (!isCurrentGeneratorRun(generatorConversationId)) return;
          mcpRuntimeRef.current = mcpRuntime;
          const custom = {
            ...baseCustomToolSetRef.current,
            ...mcpRuntime.tools,
          };
          generatorRef.current?.setCustomToolSet(custom);
          generatorRef.current?.setAllowedMcpAliases(
            new Set(mcpRuntime.aliases.keys()),
          );
          generatorRef.current?.setUntrustedReferenceContext(
            mcpRuntime.instructions,
          );
          generatorRef.current?.setSystemPromptSuffix(
            runtime.buildMemoryPromptSection(
              useMemoryStore.getState().getAll(),
            ) + requestPromptContextRef.current,
          );
          return runtime.buildToolSet({
            custom,
            planMode: false,
            runtimePlatform,
            allowedDynamicNames: new Set(mcpRuntime.aliases.keys()),
          });
        },
        dispatchSubagent: async (...args) => {
          if (!isCurrentGeneratorRun(generatorConversationId)) {
            throw new DOMException("conversation switched", "AbortError");
          }
          return dispatchSubagent(...args);
        },
        runtimePlatform,
      } satisfies Pick<
        import("../lib/ai/generator").GeneratorOptions,
        | "conversationId"
        | "tools"
        | "askUserQuestion"
        | "requestPlanApproval"
        | "onPlanApproved"
        | "dispatchSubagent"
        | "runtimePlatform"
      >;

      let candidate: GenerationBackend | null = null;
      if (isLocalRuntime) {
        if (!generatorConversationId) {
          throw new Error("The active conversation is unavailable.");
        }
        const { createLocalAgentGenerator } =
          await import("../lib/local-agent/generator");
        candidate = createLocalAgentGenerator(
          {
            provider: localProvider,
            model: localPreferences.model,
            effort: localPreferences.effort,
            nativeSearch: webSearchSettings.engine === "builtin",
            conversationId: generatorConversationId,
            getConversation: () =>
              useConversationStore.getState().conversations[
                generatorConversationId
              ] ?? null,
            saveSession: (session) => {
              if (
                generatorRef.current !== candidate ||
                !isCurrentGeneratorRun(generatorConversationId)
              ) {
                return;
              }
              useConversationStore
                .getState()
                .setLocalAgentSessionForConversation(
                  generatorConversationId,
                  localProvider,
                  session,
                );
            },
          },
          generatorEvents,
          initialFiles,
          customToolSet,
          combinedToolHandlerWithMcp,
          generatorExtras,
        );
      } else {
        candidate = runtime.createOpenAIGenerator(
          {
            apiType: currentApiType,
            apiKey: currentApiKey,
            apiBaseUrl: currentApiBaseUrl,
            model: currentModel,
            stream: true,
            providerToolNames,
          },
          generatorEvents,
          initialFiles,
          customToolSet,
          combinedToolHandlerWithMcp,
          generatorExtras,
        );
      }

      const constructionIsCurrent = isGeneratorConstructionCurrent(
        constructionEpoch,
        generatorConstructionEpochRef.current,
        generatorConversationId,
        useConversationStore.getState().activeId,
        runConversationIdRef.current,
        sameGeneratorConfig(nextConfig, currentGeneratorConfigSnapshot()),
      );
      if (!constructionIsCurrent) {
        candidate.abort();
        return null;
      }

      baseCustomToolSetRef.current = customToolSet;
      generatorRef.current = candidate;
      generatorConfigRef.current = nextConfig;
    }

    return generatorRef.current;
  }, [
    settings,
    webSearchSettings,
    assetSearchSettings,
    activeId,
    setMessages,
    setFiles,
    setTemplate,
    restartSandpack,
    clearOutputBuffers,
    flushThinkingBuffer,
    flushOutputBuffers,
    generateLocalUtilityText,
  ]);

  // Apply state that can change between generations: tool policy and the
  // request-scoped memory, Skill, custom-prompt, and Plan context.
  const applyDynamicGeneratorState = useCallback(
    async (
      generator: GenerationBackend,
      forcedSkillIds: readonly string[] = [],
      dynamicOptions: {
        includeMcp?: boolean;
        mode?: ExecutionMode;
        customSystemPromptSnapshot?: string;
      } = {},
    ) => {
      const runtime = await loadGeneratorRuntime();
      const planMode = useSettingsStore.getState().system.planModeEnabled;
      const mode = dynamicOptions.mode ?? (planMode ? "plan" : "chat");
      const mcpRuntime = await runtime.mcpManager.prepareRuntime({
        includeMcp: mode === "auto_qa" ? false : dynamicOptions.includeMcp,
      });
      mcpRuntimeRef.current =
        dynamicOptions.includeMcp === false ? null : mcpRuntime;
      const customToolSet = {
        ...baseCustomToolSetRef.current,
        ...mcpRuntime.tools,
      };
      generator.setCustomToolSet(customToolSet);
      generator.setExecutionMode(mode);
      generator.setAllowedMcpAliases(
        mode === "chat"
          ? new Set(mcpRuntime.aliases.keys())
          : mode === "plan"
            ? mcpRuntime.planModeToolNames
            : new Set(),
      );
      generator.setTools(
        runtime.buildToolSet({
          custom: customToolSet,
          planMode: mode === "plan",
          mode,
          runtimePlatform: generator.getRunContext().platform,
          allowedDynamicNames:
            mode === "chat"
              ? new Set(mcpRuntime.aliases.keys())
              : mode === "plan"
                ? mcpRuntime.planModeToolNames
                : new Set(),
        }),
      );
      if (mcpRuntime.warnings.length > 0) {
        console.warn("Some MCP servers are unavailable:", mcpRuntime.warnings);
      }
      const memorySuffix =
        mode === "chat"
          ? runtime.buildMemoryPromptSection(useMemoryStore.getState().getAll())
          : "";
      const customSystemPromptSnapshot =
        dynamicOptions.customSystemPromptSnapshot ??
        useSettingsStore.getState().system.customSystemPrompt;
      const skillContext = generator.getSkillContext();
      skillContext.clear();
      let skillsSuffix = "";
      let forcedSkillsSuffix = "";
      if ((mode === "chat" || mode === "plan") && runtime.isSkillsAvailable()) {
        const registry = await runtime.getSkillRegistry();
        skillsSuffix = runtime.buildSkillsPromptSection(
          registry.getAutoEnabled(),
        );
        const prepared = await registry.prepareForcedSkills(forcedSkillIds);
        skillContext.activateMany(prepared.map((skill) => skill.entry));
        forcedSkillsSuffix = runtime.buildForcedSkillsPromptSection(prepared);
      } else if (forcedSkillIds.length > 0) {
        throw new Error(
          "Forced skills cannot be loaded because skill storage is unavailable.",
        );
      }
      const promptSuffix = buildRunSystemPromptSuffix({
        mode,
        memory: memorySuffix,
        autoSkills: skillsSuffix,
        mandatorySkills: forcedSkillsSuffix,
        customSystemPrompt: customSystemPromptSnapshot,
        planMode: PLAN_MODE_SYSTEM_SUFFIX,
      });
      const customSystemPromptSuffix =
        mode === "chat" || mode === "plan"
          ? buildCustomSystemPromptSection(customSystemPromptSnapshot)
          : "";
      forcedSkillsPromptRef.current = forcedSkillsSuffix;
      customSystemPromptRef.current = customSystemPromptSuffix;
      // Keep the exact request-start snapshot for an approved Plan's next
      // provider iteration, even if settings change while approval is pending.
      requestPromptContextRef.current =
        skillsSuffix + customSystemPromptSuffix + forcedSkillsSuffix;
      generator.setUntrustedReferenceContext(
        mode === "auto_qa" ? "" : mcpRuntime.instructions,
      );
      generator.setSystemPromptSuffix(promptSuffix);
    },
    [],
  );

  const runAutomaticQa = useCallback(
    async (generator: GenerationBackend, result: GenerateResult | null) => {
      const runConversationId = runConversationIdRef.current;
      if (!isCurrentGeneratorRun(runConversationId)) return;
      const system = useSettingsStore.getState().system;
      if (!system.autoQaEnabled || system.planModeEnabled) return;
      if (!result || result.aborted || result.maxIterationsReached) return;
      if (Object.keys(generator.getFiles()).length === 0) return;

      await applyDynamicGeneratorState(generator, [], {
        includeMcp: false,
        mode: "auto_qa",
      });
      if (!isCurrentGeneratorRun(runConversationId)) return;
      setRunState("autoQa");
      useInteractiveStore.getState().rejectAllPending("automatic QA started");
      setMessages((prev) => [
        ...filterMemoryMessages(prev),
        {
          role: "user",
          content: AUTO_QA_PROMPT,
          metadata: { origin: "auto_qa" },
        },
      ]);
      try {
        await generator.generate(AUTO_QA_PROMPT);
      } catch (err: any) {
        if (err?.name === "AbortError") throw err;
        if (!isCurrentGeneratorRun(runConversationId)) return;
        console.error("Automatic QA failed:", err);
        appendGenerationError(
          new Error(`Automatic QA failed: ${err?.message || "Unknown error"}`),
        );
      }
    },
    [
      applyDynamicGeneratorState,
      appendGenerationError,
      isCurrentGeneratorRun,
      setMessages,
    ],
  );

  const generate = useCallback(
    async (
      prompt: string,
      attachments?: Attachment[],
      options: GenerateRunOptions = {},
    ) => {
      const runConversationId = useConversationStore.getState().activeId;
      if (!runConversationId) return;
      const customSystemPromptSnapshot =
        useSettingsStore.getState().system.customSystemPrompt;
      runConversationIdRef.current = runConversationId;
      setRunState("preparing");
      setLastError(null);
      setIsThinkingStreaming(false);
      setIsGenerating(true);

      const content = prompt;
      const attachmentRefs = attachments?.map(toAttachmentRef) ?? [];

      let userMessageAdded = false;
      try {
        const resolvedAttachments = attachments?.length
          ? await resolveAttachmentsForModel(attachments)
          : undefined;
        const generator = await getGenerator();
        if (!isCurrentGeneratorRun(runConversationId)) return;
        if (generator) {
          const storeState = useConversationStore.getState();
          const activeConv = runConversationId
            ? storeState.conversations[runConversationId]
            : null;
          if (activeConv) {
            generator.syncMessages(await getMessagesForAPI(activeConv));
          }
          await applyDynamicGeneratorState(
            generator,
            options.forcedSkillIds ?? [],
            { customSystemPromptSnapshot },
          );
        }
        if (!isCurrentGeneratorRun(runConversationId)) return;
        useInteractiveStore
          .getState()
          .rejectAllPending("new generation started");

        setMessages((prev) => [
          ...removeErrorMessages(prev),
          {
            role: "user",
            content,
            forcedSkillIds: options.forcedSkillIds,
            ...(attachmentRefs.length > 0
              ? { metadata: { attachments: attachmentRefs } }
              : {}),
          },
        ]);
        userMessageAdded = true;
        if (generator) {
          const result = await generator.generate(prompt, resolvedAttachments);
          if (
            isCurrentGeneratorRun(runConversationId) &&
            !result.aborted &&
            !result.maxIterationsReached
          ) {
            const completedMessages =
              useConversationStore.getState().conversations[runConversationId]
                ?.messages ?? result.messages;
            void triggerSmartTitle({
              conversationId: runConversationId,
              completedMessages: [...completedMessages],
              config: {
                apiType: settings.apiType,
                apiBaseUrl: settings.apiBaseUrl,
                apiKey: settings.apiKey,
                model: settings.model,
              },
            });
          }
          if (!options.skipAutoQa) {
            await runAutomaticQa(generator, result);
          }
        }
      } catch (err: any) {
        if (!isCurrentGeneratorRun(runConversationId)) return;
        if (!userMessageAdded) {
          setMessages((prev) => [
            ...removeErrorMessages(prev),
            {
              role: "user",
              content,
              forcedSkillIds: options.forcedSkillIds,
              ...(attachmentRefs.length > 0
                ? { metadata: { attachments: attachmentRefs } }
                : {}),
            },
          ]);
        }
        console.error("Error generating:", err);
        if (err?.name !== "AbortError") {
          appendGenerationError(err, { replaceExisting: true });
        }
      } finally {
        if (isCurrentGeneratorRun(runConversationId)) {
          setMessages((prev) => filterMemoryMessages(prev));
          setIsGenerating(false);
          setIsThinkingStreaming(false);
          setRunState((state) =>
            state === "error" || state === "aborted" ? state : "idle",
          );
          forcedSkillsPromptRef.current = "";
          customSystemPromptRef.current = "";
          requestPromptContextRef.current = "";
          runConversationIdRef.current = null;
        }
      }
    },
    [
      getGenerator,
      setIsGenerating,
      setMessages,
      applyDynamicGeneratorState,
      runAutomaticQa,
      appendGenerationError,
      isCurrentGeneratorRun,
      settings.apiType,
      settings.apiBaseUrl,
      settings.apiKey,
      settings.model,
      triggerSmartTitle,
    ],
  );

  const stop = useCallback(() => {
    setIsThinkingStreaming(false);
    flushOutputBuffers();
    generatorRef.current?.abort();
    forcedSkillsPromptRef.current = "";
    customSystemPromptRef.current = "";
    requestPromptContextRef.current = "";
    runConversationIdRef.current = null;
    useInteractiveStore.getState().rejectAllPending("user stopped");
    setRunState("aborted");
    setIsGenerating(false);
    createSnapshotForCurrentState();
  }, [flushOutputBuffers, setIsGenerating]);

  const retry = useCallback(async () => {
    const runConversationId = useConversationStore.getState().activeId;
    if (!runConversationId) return;
    const customSystemPromptSnapshot =
      useSettingsStore.getState().system.customSystemPrompt;
    runConversationIdRef.current = runConversationId;
    setRunState("preparing");
    setLastError(null);
    setIsThinkingStreaming(false);
    setIsGenerating(true);
    setMessages((prev) => {
      const toolResultIds = new Set(
        prev.filter((m) => m.role === "tool").map((m) => m.tool_call_id),
      );
      return prev.filter((m) => {
        if (isErrorMessage(m)) return false;
        if (m.role === "assistant" && m.tool_calls?.length) {
          return m.tool_calls.every((tc) => toolResultIds.has(tc.id));
        }
        return true;
      });
    });
    try {
      const generator = await getGenerator();
      if (!isCurrentGeneratorRun(runConversationId)) return;
      if (generator) {
        const storeState = useConversationStore.getState();
        const activeConv = runConversationId
          ? storeState.conversations[runConversationId]
          : null;
        if (activeConv) {
          generator.syncMessages(await getMessagesForAPI(activeConv));
        }
        await applyDynamicGeneratorState(
          generator,
          getLastForcedSkillIds(activeConv?.messages ?? []),
          { customSystemPromptSnapshot },
        );
        if (!isCurrentGeneratorRun(runConversationId)) return;
        await generator.retry();
      }
    } catch (err: any) {
      if (!isCurrentGeneratorRun(runConversationId)) return;
      console.error("Error retrying:", err);
      if (err?.name !== "AbortError") {
        appendGenerationError(err);
      }
    } finally {
      if (isCurrentGeneratorRun(runConversationId)) {
        setMessages((prev) => filterMemoryMessages(prev));
        setIsGenerating(false);
        setIsThinkingStreaming(false);
        setRunState((state) =>
          state === "error" || state === "aborted" ? state : "idle",
        );
        forcedSkillsPromptRef.current = "";
        customSystemPromptRef.current = "";
        requestPromptContextRef.current = "";
        runConversationIdRef.current = null;
      }
    }
  }, [
    getGenerator,
    setIsGenerating,
    setMessages,
    applyDynamicGeneratorState,
    appendGenerationError,
    isCurrentGeneratorRun,
  ]);

  const review = useCallback(async () => {
    await generate(
      "Please review all project files for security vulnerabilities. Use list_files and read_files to examine the code. Report any security issues found with severity and location, or confirm no issues were detected. If issues are found, ask if I should fix them automatically.",
      undefined,
      { skipAutoQa: true },
    );
  }, [generate]);

  const healthCheck = useCallback(async () => {
    await generate(
      "Run project_health_check with include_console=true. Summarize the health report by severity, explain the highest-impact issues first, and fix obvious project-breaking errors if they are safe to fix.",
      undefined,
      { skipAutoQa: true },
    );
  }, [generate]);

  const continueTask = useCallback(async () => {
    const runConversationId = useConversationStore.getState().activeId;
    if (!runConversationId) return;
    const customSystemPromptSnapshot =
      useSettingsStore.getState().system.customSystemPrompt;
    runConversationIdRef.current = runConversationId;
    setRunState("preparing");
    setLastError(null);
    setIsThinkingStreaming(false);
    setIsGenerating(true);
    try {
      const generator = await getGenerator();
      if (!isCurrentGeneratorRun(runConversationId)) return;
      if (generator) {
        const storeState = useConversationStore.getState();
        const activeConv = runConversationId
          ? storeState.conversations[runConversationId]
          : null;
        if (activeConv) {
          generator.syncMessages(await getMessagesForAPI(activeConv));
        }
        await applyDynamicGeneratorState(generator, [], {
          customSystemPromptSnapshot,
        });
        if (!isCurrentGeneratorRun(runConversationId)) return;
        await generator.generate(
          "Please continue where you left off and complete any unfinished tasks.",
        );
      }
    } catch (err: any) {
      if (!isCurrentGeneratorRun(runConversationId)) return;
      console.error("Error continuing:", err);
      if (err?.name !== "AbortError") {
        appendGenerationError(err);
      }
    } finally {
      if (isCurrentGeneratorRun(runConversationId)) {
        setMessages((prev) => filterMemoryMessages(prev));
        setIsGenerating(false);
        setIsThinkingStreaming(false);
        setRunState((state) =>
          state === "error" || state === "aborted" ? state : "idle",
        );
        forcedSkillsPromptRef.current = "";
        customSystemPromptRef.current = "";
        requestPromptContextRef.current = "";
        runConversationIdRef.current = null;
      }
    }
  }, [
    getGenerator,
    setIsGenerating,
    setMessages,
    applyDynamicGeneratorState,
    appendGenerationError,
    isCurrentGeneratorRun,
  ]);

  return {
    generate,
    stop,
    retry,
    continueTask,
    updateFiles,
    deleteFile,
    renameFile,
    moveFile,
    compressContext,
    review,
    healthCheck,
    invalidateGenerator,
    runState,
    lastError,
    isThinkingStreaming,
  };
}
