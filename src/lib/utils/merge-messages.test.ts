import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Message } from "../ai/generator-types";
import { en } from "../../i18n/en";
import { zh } from "../../i18n/zh";
import { TOOL_CAPABILITY_REGISTRY } from "../ai/tools-schema";

function createStorageStub(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    removeItem: (key: string) => {
      data.delete(key);
    },
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

describe("mergeMessages", () => {
  beforeAll(() => {
    vi.stubGlobal("localStorage", createStorageStub());
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("groups user attachments and hides background memory tool calls", async () => {
    const { mergeMessages } = await import("./merge-messages");
    const messages: Message[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "Build a dashboard" },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,abc" },
          },
          { type: "text", text: "[File: spec.txt | 12]\nHello world!" },
        ],
      },
      {
        role: "assistant",
        content: "I'll update the files.",
        tool_calls: [
          {
            id: "call-memory",
            type: "function",
            function: {
              name: "manage_memories",
              arguments: '{"operations":[]}',
            },
          },
          {
            id: "call-patch",
            type: "function",
            function: {
              name: "patch_file",
              arguments: '{"path":"src/App.tsx","patches":[]}',
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call-memory",
        content: "OK",
      },
      {
        role: "tool",
        tool_call_id: "call-patch",
        content: "OK — modified: src/App.tsx",
      },
    ];

    const merged = mergeMessages(messages);

    expect(merged).toHaveLength(2);
    expect(merged[0].role).toBe("user");
    expect(merged[0].blocks.map((b) => b.type)).toEqual([
      "text",
      "image",
      "file",
    ]);
    expect(merged[1].role).toBe("assistant");
    expect(
      merged[1].blocks.some(
        (block) =>
          block.type === "tool" && block.toolName === "manage_memories",
      ),
    ).toBe(false);
    expect(
      merged[1].blocks.some(
        (block) => block.type === "tool" && block.toolName === "patch_file",
      ),
    ).toBe(true);
  });

  it("covers every registered visible tool and local-provider tool with both locales", () => {
    const registeredVisibleTools = Object.keys(TOOL_CAPABILITY_REGISTRY).filter(
      // `memory` is the known policy-name mismatch; the real
      // `manage_memories` call remains intentionally hidden in this UI.
      (name) => name !== "memory",
    );
    const providerAndLegacyTools = [
      "read_file",
      "read_attachment",
      "WebSearch",
      "WebFetch",
    ];

    for (const name of [...registeredVisibleTools, ...providerAndLegacyTools]) {
      expect(zh.tool.names).toHaveProperty(name);
      expect(en.tool.names).toHaveProperty(name);
    }
  });

  it("localizes known, pending MCP and unknown tool titles without losing identifiers", async () => {
    const { mergeMessages } = await import("./merge-messages");
    const toolCalls = [
      ["health", "project_health_check", "{}"],
      ["openai-search", "web_search_preview", '{"query":"React 19"}'],
      ["google-search", "google_search", "{}"],
      ["legacy-read", "read_file", '{"path":"src/App.tsx"}'],
      ["attachment", "read_attachment", "{}"],
      ["claude-search", "WebSearch", '{"query":"release notes"}'],
      ["claude-fetch", "WebFetch", "{}"],
      ["pending-mcp", "mcp_demo_lookup_abc123", "{}"],
      ["unknown", "future_tool", '{"query":"diagnostics"}'],
    ] as const;
    const messages: Message[] = [
      {
        role: "assistant",
        content: null,
        tool_calls: toolCalls.map(([id, name, args]) => ({
          id,
          type: "function" as const,
          function: { name, arguments: args },
        })),
      },
    ];

    const titlesFor = (translations: typeof zh) =>
      mergeMessages(messages, translations)[0]
        .blocks.filter((block) => block.type === "tool")
        .map((block) => block.title);

    expect(titlesFor(zh)).toEqual([
      "检查项目健康状态",
      "搜索网络: React 19",
      "Google 搜索",
      "读取文件",
      "读取附件",
      "搜索网络: release notes",
      "读取网页",
      "MCP 工具",
      "未知工具 · future_tool: diagnostics",
    ]);
    expect(titlesFor(en)).toEqual([
      "Check Project Health",
      "Web Search: React 19",
      "Google Search",
      "Read File",
      "Read Attachment",
      "Web Search: release notes",
      "Read Web Page",
      "MCP Tool",
      "Unknown Tool · future_tool: diagnostics",
    ]);
  });

  it("uses completed MCP identity from rich output", async () => {
    const { mergeMessages } = await import("./merge-messages");
    const messages: Message[] = [
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "mcp-call",
            type: "function",
            function: { name: "mcp_demo_lookup_abc123", arguments: "{}" },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "mcp-call",
        content: "done",
        toolOutput: {
          text: "done",
          source: {
            kind: "mcp",
            serverId: "demo",
            serverName: "Demo Server",
            toolName: "lookup",
            toolTitle: "Lookup Records",
            alias: "mcp_demo_lookup_abc123",
          },
        },
      },
    ];

    const block = mergeMessages(messages, zh)[0].blocks.find(
      (candidate) => candidate.type === "tool",
    );
    expect(block).toMatchObject({ title: "Demo Server · Lookup Records" });
  });
});
