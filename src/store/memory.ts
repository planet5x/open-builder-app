import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import localforage from "localforage";
import type { MemoryItem, MemoryOperation } from "../types";
import { sanitizeMemoryOperations } from "../lib/utils/memory-limits";
import { createLocalforageStorage } from "./utils/localforage-storage";
import { runMigrations, type MigrationStep } from "./utils/migrate";

const MEMORY_STORE_VERSION = 1;
const memoryMigrations: MigrationStep[] = [];

const memoryStorage = createLocalforageStorage(
  localforage.createInstance({ name: "open-builder-memories" }),
);

interface MemoryState {
  memories: MemoryItem[];
  _hasHydrated: boolean;

  getAll: () => MemoryItem[];
  add: (content: string, category: MemoryItem["category"]) => MemoryItem;
  update: (id: string, content: string, category?: MemoryItem["category"]) => boolean;
  remove: (id: string) => boolean;
  clear: () => void;

  /** Process a batch of memory operations; returns a summary string */
  processBatch: (operations: MemoryOperation[]) => string;
}

export const useMemoryStore = create<MemoryState>()(
  persist(
    (set, get) => ({
      memories: [],
      _hasHydrated: false,

      getAll: () => get().memories,

      add: (content, category) => {
        const item: MemoryItem = {
          id: crypto.randomUUID(),
          content,
          category,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        set((s) => ({ memories: [...s.memories, item] }));
        return item;
      },

      update: (id, content, category?) => {
        const state = get();
        const index = state.memories.findIndex((m) => m.id === id);
        if (index === -1) return false;
        const updated = {
          ...state.memories[index],
          content,
          ...(category ? { category } : {}),
          updatedAt: Date.now(),
        };
        const memories = [...state.memories];
        memories[index] = updated;
        set({ memories });
        return true;
      },

      remove: (id) => {
        const state = get();
        const before = state.memories.length;
        const memories = state.memories.filter((m) => m.id !== id);
        if (memories.length === before) return false;
        set({ memories });
        return true;
      },

      clear: () => set({ memories: [] }),

      processBatch: (operations) => {
        const state = get();
        const checked = sanitizeMemoryOperations(
          operations,
          state.memories.length,
        );
        if (!checked.ok) return `Error: ${checked.error}`;
        let memories = [...state.memories];
        let added = 0;
        let updated = 0;
        let deleted = 0;
        const errors: string[] = [];

        for (const op of checked.operations) {
          switch (op.action) {
            case "add": {
              if (!op.content || !op.category) {
                errors.push("add: content and category are required");
                break;
              }
              const item: MemoryItem = {
                id: crypto.randomUUID(),
                content: op.content,
                category: op.category,
                createdAt: Date.now(),
                updatedAt: Date.now(),
              };
              memories.push(item);
              added++;
              break;
            }
            case "update": {
              if (!op.id || !op.content) {
                errors.push("update: id and content are required");
                break;
              }
              const idx = memories.findIndex((m) => m.id === op.id);
              if (idx === -1) {
                errors.push(`update: memory "${op.id}" not found`);
                break;
              }
              memories[idx] = {
                ...memories[idx],
                content: op.content,
                ...(op.category ? { category: op.category } : {}),
                updatedAt: Date.now(),
              };
              updated++;
              break;
            }
            case "delete": {
              if (!op.id) {
                errors.push("delete: id is required");
                break;
              }
              const before = memories.length;
              memories = memories.filter((m) => m.id !== op.id);
              if (memories.length < before) {
                deleted++;
              } else {
                errors.push(`delete: memory "${op.id}" not found`);
              }
              break;
            }
            default:
              errors.push(`unknown action: ${op.action}`);
          }
        }

        set({ memories });

        const parts: string[] = [];
        if (added > 0) parts.push(`${added} added`);
        if (updated > 0) parts.push(`${updated} updated`);
        if (deleted > 0) parts.push(`${deleted} deleted`);
        if (errors.length > 0) parts.push(`${errors.length} errors: ${errors.join("; ")}`);

        return `OK — ${parts.join(", ")}. Total: ${memories.length} memories.`;
      },
    }),
    {
      name: "open-builder-memories",
      version: MEMORY_STORE_VERSION,
      storage: createJSONStorage(() => memoryStorage),
      partialize: (state) => ({
        memories: state.memories,
      }),
      migrate: (persisted, version) =>
        runMigrations(
          memoryMigrations,
          persisted,
          version,
          MEMORY_STORE_VERSION,
        ),
      onRehydrateStorage: () => () => {
        useMemoryStore.setState({ _hasHydrated: true });
      },
    },
  ),
);
