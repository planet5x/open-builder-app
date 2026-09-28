import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import localforage from "localforage";
import { createPatch } from "diff";
import type { ProjectFiles, ProjectSnapshot } from "../types";
import { createLocalforageStorage } from "./utils/localforage-storage";
import { runMigrations, type MigrationStep } from "./utils/migrate";
import {
  rebuildSnapshotChainWithoutSnapshot,
  replaySnapshots,
} from "./snapshot-replay";
import {
  isSnapshotWithinStorageBudget,
  pruneSnapshotRecord,
} from "../lib/utils/storage-governance";

export { replaySnapshots } from "./snapshot-replay";

const SNAPSHOT_STORE_VERSION = 2;
/** How many patch snapshots to write between checkpoints. The first snapshot
 *  in a chain is always a checkpoint so reconstruction is anchored even for
 *  short chains. */
const CHECKPOINT_INTERVAL = 10;

const snapshotMigrations: MigrationStep[] = [
  // v1 -> v2: stamp every persisted snapshot with `kind: "patch"`. The shape
  // didn't change otherwise; legacy chains will get their first checkpoint
  // appended naturally on the next snapshot write.
  (state: any) => {
    if (state && state.snapshots && typeof state.snapshots === "object") {
      for (const convId of Object.keys(state.snapshots)) {
        const chain = state.snapshots[convId];
        if (!Array.isArray(chain)) continue;
        for (const snap of chain) {
          if (snap && !snap.kind) snap.kind = "patch";
        }
      }
    }
    return state;
  },
];

const snapshotStorage = createLocalforageStorage(
  localforage.createInstance({ name: "open-builder-snapshots" }),
);

interface SnapshotState {
  snapshots: Record<string, ProjectSnapshot[]>;
  _hasHydrated: boolean;

  createSnapshot: (
    conversationId: string,
    messageId: string,
    currentFiles: ProjectFiles,
  ) => void;

  getSnapshots: (conversationId: string) => ProjectSnapshot[];

  getSnapshotByMessageId: (
    conversationId: string,
    messageId: string,
  ) => ProjectSnapshot | undefined;

  reconstructFiles: (
    conversationId: string,
    snapshotId: string,
  ) => ProjectFiles;

  deleteSnapshotsForConversation: (conversationId: string) => void;

  renameSnapshot: (
    conversationId: string,
    snapshotId: string,
    label: string,
  ) => void;

  deleteSnapshot: (conversationId: string, snapshotId: string) => void;

  pruneSnapshots: (maxPerConversation: number) => number;

  /** Update the latest snapshot to include manual file edits */
  updateLatestSnapshot: (
    conversationId: string,
    currentFiles: ProjectFiles,
  ) => void;
}

/** Count patch snapshots that have accumulated since the most recent checkpoint. */
function patchesSinceCheckpoint(chain: ProjectSnapshot[]): number {
  for (let i = chain.length - 1; i >= 0; i--) {
    if (chain[i].kind === "checkpoint") {
      return chain.length - 1 - i;
    }
  }
  return chain.length;
}

export const useSnapshotStore = create<SnapshotState>()(
  persist(
    (set, get) => ({
      snapshots: {},
      _hasHydrated: false,

      createSnapshot: (conversationId, messageId, currentFiles) => {
        const state = get();
        const chain = state.snapshots[conversationId] ?? [];

        // Deduplicate: if a snapshot for this messageId already exists, skip
        if (chain.some((s) => s.messageId === messageId)) return;

        // Reconstruct previous file state
        const prevFiles: ProjectFiles =
          chain.length > 0
            ? replaySnapshots(chain, chain[chain.length - 1].id)
            : {};

        const patches: Record<string, string> = {};
        const addedFiles: Record<string, string> = {};
        const deletedFiles: string[] = [];

        // Detect added and modified files
        for (const [path, content] of Object.entries(currentFiles)) {
          if (!(path in prevFiles)) {
            addedFiles[path] = content;
          } else if (prevFiles[path] !== content) {
            patches[path] = createPatch(path, prevFiles[path], content);
          }
        }

        // Detect deleted files
        for (const path of Object.keys(prevFiles)) {
          if (!(path in currentFiles)) {
            deletedFiles.push(path);
          }
        }

        // Skip if nothing changed
        if (
          Object.keys(patches).length === 0 &&
          Object.keys(addedFiles).length === 0 &&
          deletedFiles.length === 0
        ) {
          return;
        }

        // Decide whether this snapshot should be a checkpoint. The first
        // snapshot in a chain is always a checkpoint; otherwise we emit one
        // every CHECKPOINT_INTERVAL patches so future reconstructions don't
        // walk the entire history.
        const isFirst = chain.length === 0;
        const dueForCheckpoint =
          patchesSinceCheckpoint(chain) >= CHECKPOINT_INTERVAL;
        const asCheckpoint = isFirst || dueForCheckpoint;

        const base: ProjectSnapshot = {
          id: crypto.randomUUID(),
          conversationId,
          messageId,
          patches,
          addedFiles,
          deletedFiles,
          createdAt: Date.now(),
          kind: asCheckpoint ? "checkpoint" : "patch",
        };
        const snapshot: ProjectSnapshot = asCheckpoint
          ? { ...base, fullFiles: { ...currentFiles } }
          : base;

        if (!isSnapshotWithinStorageBudget(snapshot)) {
          return;
        }

        set((s) => ({
          snapshots: {
            ...s.snapshots,
            [conversationId]: [...(s.snapshots[conversationId] ?? []), snapshot],
          },
        }));
      },

      getSnapshots: (conversationId) => {
        return get().snapshots[conversationId] ?? [];
      },

      getSnapshotByMessageId: (conversationId, messageId) => {
        return (get().snapshots[conversationId] ?? []).find(
          (s) => s.messageId === messageId,
        );
      },

      reconstructFiles: (conversationId, snapshotId) => {
        const chain = get().snapshots[conversationId] ?? [];
        return replaySnapshots(chain, snapshotId);
      },

      updateLatestSnapshot: (conversationId, currentFiles) => {
        const state = get();
        const chain = state.snapshots[conversationId] ?? [];
        if (chain.length === 0) return;

        const latest = chain[chain.length - 1];

        // Reconstruct file state before the latest snapshot
        const prevFiles: ProjectFiles =
          chain.length > 1
            ? replaySnapshots(chain, chain[chain.length - 2].id)
            : {};

        const patches: Record<string, string> = {};
        const addedFiles: Record<string, string> = {};
        const deletedFiles: string[] = [];

        for (const [path, content] of Object.entries(currentFiles)) {
          if (!(path in prevFiles)) {
            addedFiles[path] = content;
          } else if (prevFiles[path] !== content) {
            patches[path] = createPatch(path, prevFiles[path], content);
          }
        }
        for (const path of Object.keys(prevFiles)) {
          if (!(path in currentFiles)) {
            deletedFiles.push(path);
          }
        }

        const updatedSnapshot: ProjectSnapshot = {
          ...latest,
          patches,
          addedFiles,
          deletedFiles,
          // Keep checkpoint metadata in sync with the new file state so a
          // future replay anchored at this snapshot stays correct.
          ...(latest.kind === "checkpoint"
            ? { fullFiles: { ...currentFiles } }
            : {}),
        };

        if (!isSnapshotWithinStorageBudget(updatedSnapshot)) {
          return;
        }

        set((s) => ({
          snapshots: {
            ...s.snapshots,
            [conversationId]: [...chain.slice(0, -1), updatedSnapshot],
          },
        }));
      },

      deleteSnapshotsForConversation: (conversationId) => {
        set((s) => {
          const { [conversationId]: _, ...rest } = s.snapshots;
          return { snapshots: rest };
        });
      },

      renameSnapshot: (conversationId, snapshotId, label) => {
        set((s) => {
          const chain = s.snapshots[conversationId] ?? [];
          return {
            snapshots: {
              ...s.snapshots,
              [conversationId]: chain.map((snapshot) =>
                snapshot.id === snapshotId
                  ? { ...snapshot, label: label.trim() || undefined }
                  : snapshot,
              ),
            },
          };
        });
      },

      deleteSnapshot: (conversationId, snapshotId) => {
        set((s) => {
          const chain = s.snapshots[conversationId] ?? [];
          return {
            snapshots: {
              ...s.snapshots,
              [conversationId]: rebuildSnapshotChainWithoutSnapshot(
                chain,
                snapshotId,
                CHECKPOINT_INTERVAL,
              ),
            },
          };
        });
      },

      pruneSnapshots: (maxPerConversation) => {
        let removedCount = 0;
        set((s) => {
          const result = pruneSnapshotRecord(
            s.snapshots,
            maxPerConversation,
            CHECKPOINT_INTERVAL,
          );
          removedCount = result.removedCount;
          return { snapshots: result.snapshots };
        });
        return removedCount;
      },
    }),
    {
      name: "open-builder-snapshots",
      version: SNAPSHOT_STORE_VERSION,
      storage: createJSONStorage(() => snapshotStorage),
      partialize: (state) => ({
        snapshots: state.snapshots,
      }),
      migrate: (persisted, version) =>
        runMigrations(
          snapshotMigrations,
          persisted,
          version,
          SNAPSHOT_STORE_VERSION,
        ),
      onRehydrateStorage: () => () => {
        useSnapshotStore.setState({ _hasHydrated: true });
      },
    },
  ),
);
