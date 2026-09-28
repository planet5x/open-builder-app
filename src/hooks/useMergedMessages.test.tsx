// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useMergedMessages } from "./useMergedMessages";
import { useSettingsStore } from "../store/settings";
import type { Message } from "../types";

const messages: Message[] = [
  {
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id: "health",
        type: "function",
        function: { name: "project_health_check", arguments: "{}" },
      },
    ],
  },
];

describe("useMergedMessages", () => {
  const originalSystem = useSettingsStore.getState().system;

  afterEach(() => {
    useSettingsStore.getState().setSystem(originalSystem);
  });

  it("recomputes existing tool titles when the locale changes", () => {
    useSettingsStore.getState().setSystem({
      ...originalSystem,
      language: "zh",
    });
    const { result } = renderHook(() => useMergedMessages(messages));

    expect(result.current[0].blocks[0]).toMatchObject({
      title: "检查项目健康状态",
    });

    act(() => {
      useSettingsStore.getState().setSystem({
        ...originalSystem,
        language: "en",
      });
    });

    expect(result.current[0].blocks[0]).toMatchObject({
      title: "Check Project Health",
    });
  });
});
