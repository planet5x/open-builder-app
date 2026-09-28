import type {
  Conversation,
  MemoryItem,
  ProjectSnapshot,
  ProjectTemplate,
} from "../../types";
import type { SkillEntry } from "../skills/types";
import { rebuildSnapshotChainWithoutSnapshot } from "../../store/snapshot-replay";

export interface StorageReport {
  totalBytes: number;
  conversations: {
    count: number;
    archivedCount: number;
    emptyCount: number;
    bytes: number;
    messagesCount: number;
    messagesBytes: number;
    projectFileCount: number;
    projectFilesBytes: number;
    compressedContextBytes: number;
  };
  snapshots: {
    count: number;
    bytes: number;
    checkpointCount: number;
    patchCount: number;
  };
  memories: { count: number; bytes: number };
  skills: { count: number; bytes: number };
  templates: { count: number; bytes: number };
  cleanup: {
    archivedConversationIds: string[];
    emptyConversationIds: string[];
    prunableSnapshotCount: number;
  };
}

export const SNAPSHOT_STORAGE_LIMITS = {
  maxSnapshotBytes: 2 * 1024 * 1024,
} as const;

export interface StorageReportInput {
  conversations: Record<string, Conversation>;
  activeConversationId: string | null;
  snapshots: Record<string, ProjectSnapshot[]>;
  memories: MemoryItem[];
  skills: Record<string, SkillEntry>;
  templates?: Record<string, ProjectTemplate>;
  maxSnapshotsPerConversation?: number;
}

export function estimateJsonBytes(value: unknown): number {
  const json = JSON.stringify(value ?? null);
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(json).length;
  }
  return json.length;
}

export function isSnapshotWithinStorageBudget(
  snapshot: ProjectSnapshot,
): boolean {
  return estimateJsonBytes(snapshot) <= SNAPSHOT_STORAGE_LIMITS.maxSnapshotBytes;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  const precision = value >= 10 || unitIndex === 0 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

export function isEmptyConversation(conversation: Conversation): boolean {
  return (
    conversation.messages.length === 0 &&
    Object.keys(conversation.files).length === 0 &&
    !conversation.isProjectInitialized
  );
}

export function getArchivedConversationCleanupIds(
  conversations: Record<string, Conversation>,
  activeConversationId: string | null,
): string[] {
  return Object.values(conversations)
    .filter((conversation) => conversation.archived)
    .filter((conversation) => conversation.id !== activeConversationId)
    .map((conversation) => conversation.id);
}

export function getEmptyConversationCleanupIds(
  conversations: Record<string, Conversation>,
  activeConversationId: string | null,
): string[] {
  return Object.values(conversations)
    .filter(isEmptyConversation)
    .filter((conversation) => conversation.id !== activeConversationId)
    .map((conversation) => conversation.id);
}

export function pruneSnapshotRecord(
  snapshots: Record<string, ProjectSnapshot[]>,
  maxPerConversation: number,
  checkpointInterval = 10,
): { snapshots: Record<string, ProjectSnapshot[]>; removedCount: number } {
  const limit = Math.max(1, Math.floor(maxPerConversation));
  let removedCount = 0;
  const next: Record<string, ProjectSnapshot[]> = {};

  for (const [conversationId, chain] of Object.entries(snapshots)) {
    let rebuilt = chain;
    while (rebuilt.length > limit) {
      rebuilt = rebuildSnapshotChainWithoutSnapshot(
        rebuilt,
        rebuilt[0].id,
        checkpointInterval,
      );
      removedCount++;
    }
    next[conversationId] = rebuilt;
  }

  return { snapshots: next, removedCount };
}

export function analyzeStorage(input: StorageReportInput): StorageReport {
  const maxSnapshots = input.maxSnapshotsPerConversation ?? 20;
  const conversations = Object.values(input.conversations);
  const snapshotChains = Object.values(input.snapshots);
  const allSnapshots = snapshotChains.flat();

  const messagesCount = conversations.reduce(
    (sum, conversation) => sum + conversation.messages.length,
    0,
  );
  const projectFileCount = conversations.reduce(
    (sum, conversation) => sum + Object.keys(conversation.files).length,
    0,
  );

  const messagesBytes = conversations.reduce(
    (sum, conversation) => sum + estimateJsonBytes(conversation.messages),
    0,
  );
  const projectFilesBytes = conversations.reduce(
    (sum, conversation) => sum + estimateJsonBytes(conversation.files),
    0,
  );
  const compressedContextBytes = conversations.reduce(
    (sum, conversation) =>
      sum + estimateJsonBytes(conversation.compressedContext ?? null),
    0,
  );

  const conversationBytes = estimateJsonBytes(input.conversations);
  const snapshotBytes = estimateJsonBytes(input.snapshots);
  const memoriesBytes = estimateJsonBytes(input.memories);
  const skillsBytes = estimateJsonBytes(input.skills);
  const templates = input.templates ?? {};
  const templatesBytes = estimateJsonBytes(templates);

  const prunableSnapshotCount = snapshotChains.reduce(
    (sum, chain) => sum + Math.max(0, chain.length - maxSnapshots),
    0,
  );

  return {
    totalBytes:
      conversationBytes +
      snapshotBytes +
      memoriesBytes +
      skillsBytes +
      templatesBytes,
    conversations: {
      count: conversations.length,
      archivedCount: conversations.filter((conversation) => conversation.archived)
        .length,
      emptyCount: conversations.filter(isEmptyConversation).length,
      bytes: conversationBytes,
      messagesCount,
      messagesBytes,
      projectFileCount,
      projectFilesBytes,
      compressedContextBytes,
    },
    snapshots: {
      count: allSnapshots.length,
      bytes: snapshotBytes,
      checkpointCount: allSnapshots.filter(
        (snapshot) => snapshot.kind === "checkpoint",
      ).length,
      patchCount: allSnapshots.filter((snapshot) => snapshot.kind !== "checkpoint")
        .length,
    },
    memories: {
      count: input.memories.length,
      bytes: memoriesBytes,
    },
    skills: {
      count: Object.keys(input.skills).length,
      bytes: skillsBytes,
    },
    templates: {
      count: Object.keys(templates).length,
      bytes: templatesBytes,
    },
    cleanup: {
      archivedConversationIds: getArchivedConversationCleanupIds(
        input.conversations,
        input.activeConversationId,
      ),
      emptyConversationIds: getEmptyConversationCleanupIds(
        input.conversations,
        input.activeConversationId,
      ),
      prunableSnapshotCount,
    },
  };
}
