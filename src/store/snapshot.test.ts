import { createPatch } from "diff";
import { describe, expect, it } from "vitest";
import {
  rebuildSnapshotChainWithoutSnapshot,
  replaySnapshots,
} from "./snapshot-replay";
import type { ProjectSnapshot } from "../types";

describe("replaySnapshots", () => {
  it("reconstructs files from the nearest checkpoint to the requested snapshot", () => {
    const chain: ProjectSnapshot[] = [
      {
        id: "initial",
        conversationId: "conv-1",
        messageId: "assistant-0",
        patches: {},
        addedFiles: { "src/App.tsx": "old app\n", "README.md": "readme\n" },
        deletedFiles: [],
        createdAt: 1,
        kind: "checkpoint",
        fullFiles: { "src/App.tsx": "old app\n", "README.md": "readme\n" },
      },
      {
        id: "change",
        conversationId: "conv-1",
        messageId: "assistant-1",
        patches: {
          "src/App.tsx": createPatch(
            "src/App.tsx",
            "old app\n",
            "new app\n",
          ),
        },
        addedFiles: { "src/main.tsx": "mount();\n" },
        deletedFiles: ["README.md"],
        createdAt: 2,
        kind: "patch",
      },
    ];

    expect(replaySnapshots(chain, "change")).toEqual({
      "src/App.tsx": "new app\n",
      "src/main.tsx": "mount();\n",
    });
  });

  it("falls back to replaying the whole chain when the target id is unknown", () => {
    const chain: ProjectSnapshot[] = [
      {
        id: "one",
        conversationId: "conv-1",
        messageId: "assistant-0",
        patches: {},
        addedFiles: { "a.txt": "A\n" },
        deletedFiles: [],
        createdAt: 1,
      },
      {
        id: "two",
        conversationId: "conv-1",
        messageId: "assistant-1",
        patches: { "a.txt": createPatch("a.txt", "A\n", "B\n") },
        addedFiles: {},
        deletedFiles: [],
        createdAt: 2,
      },
    ];

    expect(replaySnapshots(chain, "missing")).toEqual({ "a.txt": "B\n" });
  });

  it("rebuilds the patch chain when deleting a middle snapshot", () => {
    const chain: ProjectSnapshot[] = [
      {
        id: "one",
        conversationId: "conv-1",
        messageId: "assistant-0",
        patches: {},
        addedFiles: { "a.txt": "A\n" },
        deletedFiles: [],
        createdAt: 1,
        kind: "checkpoint",
        fullFiles: { "a.txt": "A\n" },
      },
      {
        id: "two",
        conversationId: "conv-1",
        messageId: "assistant-1",
        patches: { "a.txt": createPatch("a.txt", "A\n", "B\n") },
        addedFiles: {},
        deletedFiles: [],
        createdAt: 2,
        kind: "patch",
      },
      {
        id: "three",
        conversationId: "conv-1",
        messageId: "assistant-2",
        patches: { "a.txt": createPatch("a.txt", "B\n", "C\n") },
        addedFiles: { "b.txt": "B file\n" },
        deletedFiles: [],
        createdAt: 3,
        kind: "patch",
      },
    ];

    const rebuilt = rebuildSnapshotChainWithoutSnapshot(chain, "two");

    expect(rebuilt.map((snapshot) => snapshot.id)).toEqual(["one", "three"]);
    expect(replaySnapshots(rebuilt, "three")).toEqual({
      "a.txt": "C\n",
      "b.txt": "B file\n",
    });
  });
});
