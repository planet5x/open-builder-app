// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "../../store/settings";
import { ToolCallCard } from "./ToolCallCard";

const originalSystem = useSettingsStore.getState().system;

describe("ToolCallCard UI", () => {
  afterEach(() => {
    useSettingsStore.getState().setSystem(originalSystem);
  });

  it("adds a localized accessible status without changing result payloads", () => {
    useSettingsStore.getState().setSystem({
      ...originalSystem,
      language: "zh",
    });

    render(
      <ToolCallCard
        toolName="image_search"
        title="搜索图片"
        path=""
        result={'{"ok":false,"error":"provider unavailable"}'}
        toolCallId="image-search"
      />,
    );

    expect(
      screen.getByRole("button", { name: /搜索图片.*失败/ }),
    ).toBeInTheDocument();
  });

  it("localizes MCP result chrome while preserving third-party content", async () => {
    useSettingsStore.getState().setSystem({
      ...originalSystem,
      language: "zh",
    });
    const user = userEvent.setup();

    render(
      <ToolCallCard
        toolName="mcp_demo_lookup_abc123"
        title="Demo Server · Lookup Records"
        path=""
        result="third-party result"
        toolCallId="mcp-call"
        toolOutput={{
          text: "third-party result",
          structuredContent: { count: 1 },
          content: [
            {
              type: "image",
              data: "iVBORw0KGgo=",
              mimeType: "image/png",
            },
          ],
          source: {
            kind: "mcp",
            serverId: "demo",
            serverName: "Demo Server",
            toolName: "lookup",
            toolTitle: "Lookup Records",
            alias: "mcp_demo_lookup_abc123",
          },
        }}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /Demo Server.*已完成/ }),
    );
    expect(screen.getByText("结构化内容")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "MCP 工具结果" }),
    ).toBeInTheDocument();
  });
});
