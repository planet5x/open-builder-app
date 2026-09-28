// Ephemeral: not persisted. UI replays from the SubagentToolResult JSON in
// conversation messages once a run completes.

import { create } from "zustand";
import type {
  SubagentEvent,
  SubagentProgress,
  SubagentStatus,
} from "../lib/ai/subagents/types";
import {
  SUBAGENT_LIMITS,
  truncateSubagentText,
} from "../lib/ai/subagents/limits";

interface SubagentStoreState {
  progress: Record<string, SubagentProgress>;

  init: (toolCallId: string, subagent: string, task: string) => void;
  appendText: (toolCallId: string, delta: string) => void;
  addToolCall: (toolCallId: string, name: string, innerId: string) => void;
  setToolResult: (toolCallId: string, innerId: string, preview: string) => void;
  markStatus: (
    toolCallId: string,
    status: SubagentStatus,
    error?: string,
  ) => void;
  clear: (toolCallId: string) => void;
}

export const useSubagentStore = create<SubagentStoreState>((set) => ({
  progress: {},

  init: (toolCallId, subagent, task) =>
    set((s) => ({
      progress: {
        ...s.progress,
        [toolCallId]: {
          subagent,
          task: truncateSubagentText(task, SUBAGENT_LIMITS.maxTaskChars),
          status: "running",
          text: "",
          events: [],
          startedAt: Date.now(),
        },
      },
    })),

  appendText: (toolCallId, delta) =>
    set((s) => {
      const cur = s.progress[toolCallId];
      if (!cur) return s;
      return {
        progress: {
          ...s.progress,
          [toolCallId]: {
            ...cur,
            text: truncateSubagentText(
              cur.text + delta,
              SUBAGENT_LIMITS.maxLiveTextChars,
            ),
          },
        },
      };
    }),

  addToolCall: (toolCallId, name, innerId) =>
    set((s) => {
      const cur = s.progress[toolCallId];
      if (!cur) return s;
      if (cur.events.some((e) => e.toolCallId === innerId)) return s;
      if (cur.events.length >= SUBAGENT_LIMITS.maxEvents) return s;
      const event: SubagentEvent = {
        name,
        toolCallId: innerId,
        resultPreview: "",
      };
      return {
        progress: {
          ...s.progress,
          [toolCallId]: { ...cur, events: [...cur.events, event] },
        },
      };
    }),

  setToolResult: (toolCallId, innerId, preview) =>
    set((s) => {
      const cur = s.progress[toolCallId];
      if (!cur) return s;
      const idx = cur.events.findIndex((e) => e.toolCallId === innerId);
      if (idx === -1) return s;
      const events = cur.events.slice();
      events[idx] = {
        ...events[idx],
        resultPreview: truncateSubagentText(
          preview,
          SUBAGENT_LIMITS.maxToolPreviewChars,
        ),
      };
      return {
        progress: { ...s.progress, [toolCallId]: { ...cur, events } },
      };
    }),

  markStatus: (toolCallId, status, error) =>
    set((s) => {
      const cur = s.progress[toolCallId];
      if (!cur) return s;
      return {
        progress: {
          ...s.progress,
          [toolCallId]: {
            ...cur,
            status,
            error:
              error == null
                ? undefined
                : truncateSubagentText(error, SUBAGENT_LIMITS.maxErrorChars),
            finishedAt: Date.now(),
          },
        },
      };
    }),

  clear: (toolCallId) =>
    set((s) => {
      if (!(toolCallId in s.progress)) return s;
      const next = { ...s.progress };
      delete next[toolCallId];
      return { progress: next };
    }),
}));
