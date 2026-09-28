import { createPatch } from "diff";
import { describe, expect, it } from "vitest";
import type { Conversation, ProjectSnapshot } from "../../types";
import {
  SNAPSHOT_STORAGE_LIMITS,
  analyzeStorage,
  formatBytes,
  getArchivedConversationCleanupIds,
  getEmptyConversationCleanupIds,
  isSnapshotWithinStorageBudget,
  pruneSnapshotRecord,
} from "./storage-governance";
import { replaySnapshots } from "../../store/snapshot-replay";

function conversation(
  id: string,
  overrides: Partial<Conversation> = {},
): Conversation {
  return {
    id,
    title: id,
    messages: [],
    files: {},
    template: "vite-react-ts",
    isProjectInitialized: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("storage governance", () => {
  it("formats byte counts with stable units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.00 MB");
  });

  it("excludes the active conversation from cleanup candidates", () => {
    const conversations = {
      active: conversation("active", { archived: true }),
      archived: conversation("archived", { archived: true }),
      empty: conversation("empty"),
      project: conversation("project", {
        files: { "src/App.tsx": "app" },
        isProjectInitialized: true,
      }),
    };

    expect(getArchivedConversationCleanupIds(conversations, "active")).toEqual([
      "archived",
    ]);
    expect(getEmptyConversationCleanupIds(conversations, "empty")).toEqual([
      "active",
      "archived",
    ]);
  });

  it("reports data categories and prunable snapshots", () => {
    const report = analyzeStorage({
      activeConversationId: "active",
      conversations: {
        active: conversation("active", {
          messages: [{ role: "user", content: "hello" }],
          files: { "src/App.tsx": "app" },
          compressedContext: { summary: "old", fromIndex: 1 },
        }),
        archived: conversation("archived", { archived: true }),
      },
      snapshots: {
        active: [
          snapshot("one", "active", "A\n", 1),
          snapshot("two", "active", "B\n", 2),
          snapshot("three", "active", "C\n", 3),
        ],
      },
      memories: [
        {
          id: "memory",
          content: "Likes TypeScript",
          category: "preference",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      skills: {},
      templates: {
        starter: {
          id: "starter",
          name: "Starter",
          files: { "src/App.tsx": "app" },
          template: "vite-react-ts",
          tags: ["react"],
          createdAt: 1,
          updatedAt: 1,
        },
      },
      maxSnapshotsPerConversation: 2,
    });

    expect(report.conversations.count).toBe(2);
    expect(report.conversations.messagesCount).toBe(1);
    expect(report.conversations.projectFileCount).toBe(1);
    expect(report.snapshots.count).toBe(3);
    expect(report.memories.count).toBe(1);
    expect(report.templates.count).toBe(1);
    expect(report.templates.bytes).toBeGreaterThan(0);
    expect(report.cleanup.archivedConversationIds).toEqual(["archived"]);
    expect(report.cleanup.prunableSnapshotCount).toBe(1);
    expect(report.totalBytes).toBeGreaterThan(0);
  });

  it("prunes old snapshots while preserving replay correctness", () => {
    const chain: ProjectSnapshot[] = [
      snapshot("one", "conv", "A\n", 1),
      {
        id: "two",
        conversationId: "conv",
        messageId: "assistant-2",
        patches: { "a.txt": createPatch("a.txt", "A\n", "B\n") },
        addedFiles: {},
        deletedFiles: [],
        createdAt: 2,
        kind: "patch",
      },
      {
        id: "three",
        conversationId: "conv",
        messageId: "assistant-3",
        patches: { "a.txt": createPatch("a.txt", "B\n", "C\n") },
        addedFiles: { "b.txt": "B file\n" },
        deletedFiles: [],
        createdAt: 3,
        kind: "patch",
      },
    ];

    const result = pruneSnapshotRecord({ conv: chain }, 2);

    expect(result.removedCount).toBe(1);
    expect(result.snapshots.conv.map((item) => item.id)).toEqual([
      "two",
      "three",
    ]);
    expect(replaySnapshots(result.snapshots.conv, "three")).toEqual({
      "a.txt": "C\n",
      "b.txt": "B file\n",
    });
    expect(result.snapshots.conv[0].kind).toBe("checkpoint");
  });

  it("detects snapshots that exceed the storage budget", () => {
    expect(
      isSnapshotWithinStorageBudget(
        snapshot(
          "large",
          "conv",
          "x".repeat(SNAPSHOT_STORAGE_LIMITS.maxSnapshotBytes + 1),
          1,
        ),
      ),
    ).toBe(false);
  });
});

function snapshot(
  id: string,
  conversationId: string,
  content: string,
  createdAt: number,
): ProjectSnapshot {
  return {
    id,
    conversationId,
    messageId: `assistant-${createdAt}`,
    patches: {},
    addedFiles: { "a.txt": content },
    deletedFiles: [],
    createdAt,
    kind: "checkpoint",
    fullFiles: { "a.txt": content },
  };
}
