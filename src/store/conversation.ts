import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import localforage from "localforage";
import { useSnapshotStore } from "./snapshot";
import { runMigrations, type MigrationStep } from "./utils/migrate";
import type {
  Conversation,
  CompressedContext,
  LocalAgentProvider,
  LocalAgentSessionRef,
  Message,
  ProjectPreviewMode,
  ProjectFiles,
} from "../types";
import { validateProjectFiles } from "../lib/utils/project-files";
import { deleteAttachmentsForMessages } from "../lib/attachments/store";
import { normalizeCompressedSummary } from "../lib/utils/compress-context";

const CONVERSATION_STORE_VERSION = 3;
const DEFAULT_PROJECT_TEMPLATE = "vite-react-ts";

export function normalizeConversationProjectState<T extends Conversation>(
  conversation: T,
): T {
  const paths = Object.keys(conversation.files);
  const activeFile =
    conversation.activeFile && conversation.activeFile in conversation.files
      ? conversation.activeFile
      : paths[0];
  const isProjectInitialized = paths.length > 0;
  const previewMode: ProjectPreviewMode =
    conversation.previewMode === "code-only" ? "code-only" : "sandpack";

  if (
    conversation.activeFile === activeFile &&
    conversation.isProjectInitialized === isProjectInitialized &&
    conversation.previewMode === previewMode
  ) {
    return conversation;
  }

  return {
    ...conversation,
    activeFile,
    previewMode,
    isProjectInitialized,
  } as T;
}

export function normalizePersistedConversationProjects<T>(state: T): T {
  if (!state || typeof state !== "object") return state;
  const conversations = (state as { conversations?: unknown }).conversations;
  if (!conversations || typeof conversations !== "object") return state;

  return {
    ...state,
    conversations: Object.fromEntries(
      Object.entries(conversations).map(([id, conversation]) => [
        id,
        normalizeConversationProjectState(conversation as Conversation),
      ]),
    ),
  };
}

const conversationMigrations: MigrationStep[] = [
  (state) => state,
  normalizePersistedConversationProjects,
  normalizePersistedConversationProjects,
];

export function migrateConversationState<T>(persisted: T, version: number): T {
  return runMigrations(
    conversationMigrations,
    persisted,
    version,
    CONVERSATION_STORE_VERSION,
  );
}

function normalizeStoredCompressedContext(
  context: CompressedContext | undefined,
): CompressedContext | undefined {
  if (
    !context ||
    typeof context.summary !== "string" ||
    !Number.isFinite(context.fromIndex)
  ) {
    return undefined;
  }
  return {
    ...context,
    fromIndex: Math.max(0, Math.floor(context.fromIndex)),
    summary: normalizeCompressedSummary(context.summary),
  };
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Sentinel value for the default untitled conversation title */
export const DEFAULT_TITLE = "__new_app__";

// ─── localforage storage adapter ─────────────────────────────────────────────

const localforageStorage = {
  getItem: async (name: string) => {
    const value = await localforage.getItem<string>(name);
    return value ?? null;
  },
  setItem: async (name: string, value: string) => {
    await localforage.setItem(name, value);
  },
  removeItem: async (name: string) => {
    await localforage.removeItem(name);
  },
};

// ─── Store types ─────────────────────────────────────────────────────────────

type Updater<T> = T | ((prev: T) => T);
function applyUpdater<T>(updater: Updater<T>, prev: T): T {
  return typeof updater === "function"
    ? (updater as (p: T) => T)(prev)
    : updater;
}

interface ConversationState {
  conversations: Record<string, Conversation>;
  activeId: string | null;
  _hasHydrated: boolean;

  createConversation: () => string;
  addConversation: (conversation: Conversation) => string;
  deleteConversation: (id: string) => void;
  switchConversation: (id: string) => void;

  forkConversation: () => string;
  setMessages: (updater: Updater<Message[]>) => void;
  setFiles: (updater: Updater<ProjectFiles>) => void;
  setFilesForConversation: (id: string, updater: Updater<ProjectFiles>) => void;
  replaceProject: (input: {
    files: ProjectFiles;
    template: string;
    previewMode: ProjectPreviewMode;
    activeFile?: string;
  }) => { ok: true } | { ok: false; error: string };
  setActiveFile: (path: string) => void;
  setTemplate: (updater: Updater<string>) => void;
  clearContext: () => void;
  resetProject: () => void;
  setCompressedContext: (ctx: CompressedContext) => void;
  setCompressedContextForConversation: (
    id: string,
    ctx: CompressedContext,
  ) => void;
  setLocalAgentSessionForConversation: (
    id: string,
    provider: LocalAgentProvider,
    session: LocalAgentSessionRef | undefined,
  ) => void;
  renameConversation: (id: string, title: string) => void;
  pinConversation: (id: string) => void;
  unpinConversation: (id: string) => void;
  archiveConversation: (id: string) => void;
  unarchiveConversation: (id: string) => void;
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useConversationStore = create<ConversationState>()(
  persist(
    (set, get) => ({
      conversations: {},
      activeId: null,
      _hasHydrated: false,

      createConversation: () => {
        const id = crypto.randomUUID();
        const conv: Conversation = {
          id,
          title: DEFAULT_TITLE,
          messages: [],
          files: {},
          template: DEFAULT_PROJECT_TEMPLATE,
          previewMode: "sandpack",
          isProjectInitialized: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        set((s) => ({
          conversations: { ...s.conversations, [id]: conv },
          activeId: id,
        }));
        return id;
      },

      addConversation: (conversation) => {
        const validation = validateProjectFiles(conversation.files);
        if (!validation.ok) {
          throw new Error(validation.error);
        }
        const id = conversation.id || crypto.randomUUID();
        const now = Date.now();
        const conv = normalizeConversationProjectState<Conversation>({
          ...conversation,
          id,
          title: conversation.title || DEFAULT_TITLE,
          messages: [...conversation.messages],
          files: { ...conversation.files },
          compressedContext: normalizeStoredCompressedContext(
            conversation.compressedContext,
          ),
          createdAt: conversation.createdAt || now,
          updatedAt: now,
        });
        set((s) => ({
          conversations: { ...s.conversations, [id]: conv },
          activeId: id,
        }));
        return id;
      },

      forkConversation: () => {
        const s = get();
        const src = s.activeId ? s.conversations[s.activeId] : null;
        const id = crypto.randomUUID();
        const conv = normalizeConversationProjectState<Conversation>({
          id,
          title: src ? src.title : DEFAULT_TITLE,
          messages: src ? [...src.messages] : [],
          files: src ? { ...src.files } : {},
          activeFile: src?.activeFile,
          template: src?.template ?? DEFAULT_PROJECT_TEMPLATE,
          previewMode: src?.previewMode ?? "sandpack",
          isProjectInitialized: src?.isProjectInitialized ?? false,
          compressedContext: normalizeStoredCompressedContext(
            src?.compressedContext,
          ),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        set({
          conversations: { ...s.conversations, [id]: conv },
          activeId: id,
        });
        return id;
      },

      deleteConversation: (id) => {
        const current = get();
        const deletedMessages = current.conversations[id]?.messages ?? [];
        const retainedMessages = Object.values(current.conversations)
          .filter((conversation) => conversation.id !== id)
          .flatMap((conversation) => conversation.messages);
        useSnapshotStore.getState().deleteSnapshotsForConversation(id);
        set((s) => {
          const { [id]: _, ...rest } = s.conversations;
          let nextActiveId = s.activeId;
          if (s.activeId === id) {
            const remaining = Object.values(rest).sort(
              (a, b) => b.updatedAt - a.updatedAt,
            );
            nextActiveId = remaining[0]?.id ?? null;
          }
          return { conversations: rest, activeId: nextActiveId };
        });
        void deleteAttachmentsForMessages(
          deletedMessages,
          retainedMessages,
        ).catch((error) => {
          console.warn("Failed to release conversation attachments:", error);
        });
      },

      switchConversation: (id) => {
        set({ activeId: id });
      },

      setMessages: (updater) => {
        set((s) => {
          if (!s.activeId || !s.conversations[s.activeId]) return s;
          const conv = s.conversations[s.activeId];
          const newMessages = applyUpdater(updater, conv.messages);
          return {
            conversations: {
              ...s.conversations,
              [s.activeId]: {
                ...conv,
                messages: newMessages,
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      setFiles: (updater) => {
        const activeId = get().activeId;
        if (activeId) get().setFilesForConversation(activeId, updater);
      },

      setFilesForConversation: (id, updater) => {
        set((s) => {
          if (!s.conversations[id]) return s;
          const conv = s.conversations[id];
          const files = applyUpdater(updater, conv.files);
          const validation = validateProjectFiles(files);
          if (!validation.ok) {
            console.warn(
              "[conversation] Rejected project files:",
              validation.error,
            );
            return s;
          }
          const nextConversation = normalizeConversationProjectState({
            ...conv,
            files,
            updatedAt: Date.now(),
          });
          return {
            conversations: {
              ...s.conversations,
              [id]: nextConversation,
            },
          };
        });
      },

      replaceProject: ({ files, template, previewMode, activeFile }) => {
        const activeId = get().activeId;
        if (!activeId || !get().conversations[activeId]) {
          return { ok: false, error: "No active conversation." };
        }
        const validation = validateProjectFiles(files);
        if (!validation.ok) {
          return { ok: false, error: validation.error };
        }
        const paths = Object.keys(files);
        const nextActiveFile =
          activeFile && activeFile in files ? activeFile : paths[0];
        useSnapshotStore.getState().deleteSnapshotsForConversation(activeId);
        set((state) => {
          const conversation = state.conversations[activeId];
          if (!conversation) return state;
          return {
            conversations: {
              ...state.conversations,
              [activeId]: {
                ...conversation,
                files: { ...files },
                template,
                previewMode,
                activeFile: nextActiveFile,
                isProjectInitialized: paths.length > 0,
                localAgentSessions: undefined,
                updatedAt: Date.now(),
              },
            },
          };
        });
        return { ok: true };
      },

      setActiveFile: (path) => {
        const activeId = get().activeId;
        const conv = activeId ? get().conversations[activeId] : undefined;
        if (!activeId || !conv || !(path in conv.files)) return;
        set((state) => ({
          conversations: {
            ...state.conversations,
            [activeId]: {
              ...conv,
              activeFile: path,
              updatedAt: Date.now(),
            },
          },
        }));
      },

      clearContext: () => {
        set((s) => {
          if (!s.activeId || !s.conversations[s.activeId]) return s;
          const conv = s.conversations[s.activeId];
          return {
            conversations: {
              ...s.conversations,
              [s.activeId]: {
                ...conv,
                messages: [],
                compressedContext: undefined,
                localAgentSessions: undefined,
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      resetProject: () => {
        const activeId = get().activeId;
        if (!activeId || !get().conversations[activeId]) return;
        useSnapshotStore.getState().deleteSnapshotsForConversation(activeId);
        set((s) => {
          const conv = s.conversations[activeId];
          if (!conv) return s;
          return {
            conversations: {
              ...s.conversations,
              [activeId]: {
                ...conv,
                messages: [],
                files: {},
                template: DEFAULT_PROJECT_TEMPLATE,
                previewMode: "sandpack",
                isProjectInitialized: false,
                compressedContext: undefined,
                localAgentSessions: undefined,
                activeFile: undefined,
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      setTemplate: (updater) => {
        set((s) => {
          if (!s.activeId || !s.conversations[s.activeId]) return s;
          const conv = s.conversations[s.activeId];
          return {
            conversations: {
              ...s.conversations,
              [s.activeId]: {
                ...conv,
                template: applyUpdater(updater, conv.template),
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      setCompressedContext: (ctx) => {
        const activeId = get().activeId;
        if (activeId) get().setCompressedContextForConversation(activeId, ctx);
      },

      setCompressedContextForConversation: (id, ctx) => {
        set((s) => {
          if (!s.conversations[id]) return s;
          const conv = s.conversations[id];
          const normalizedContext = normalizeStoredCompressedContext(ctx);
          return {
            conversations: {
              ...s.conversations,
              [id]: {
                ...conv,
                compressedContext: normalizedContext,
                localAgentSessions: undefined,
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      setLocalAgentSessionForConversation: (id, provider, session) => {
        set((state) => {
          const conversation = state.conversations[id];
          if (!conversation) return state;
          const localAgentSessions = {
            ...(conversation.localAgentSessions ?? {}),
          };
          if (session) localAgentSessions[provider] = session;
          else delete localAgentSessions[provider];
          return {
            conversations: {
              ...state.conversations,
              [id]: {
                ...conversation,
                localAgentSessions:
                  Object.keys(localAgentSessions).length > 0
                    ? localAgentSessions
                    : undefined,
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      renameConversation: (id, title) => {
        set((s) => {
          if (!s.conversations[id]) return s;
          return {
            conversations: {
              ...s.conversations,
              [id]: { ...s.conversations[id], title, updatedAt: Date.now() },
            },
          };
        });
      },

      pinConversation: (id) => {
        set((s) => {
          if (!s.conversations[id]) return s;
          return {
            conversations: {
              ...s.conversations,
              [id]: {
                ...s.conversations[id],
                pinned: true,
                archived: false,
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      unpinConversation: (id) => {
        set((s) => {
          if (!s.conversations[id]) return s;
          return {
            conversations: {
              ...s.conversations,
              [id]: {
                ...s.conversations[id],
                pinned: false,
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      archiveConversation: (id) => {
        set((s) => {
          if (!s.conversations[id]) return s;
          return {
            conversations: {
              ...s.conversations,
              [id]: {
                ...s.conversations[id],
                archived: true,
                pinned: false,
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      unarchiveConversation: (id) => {
        set((s) => {
          if (!s.conversations[id]) return s;
          return {
            conversations: {
              ...s.conversations,
              [id]: {
                ...s.conversations[id],
                archived: false,
                updatedAt: Date.now(),
              },
            },
          };
        });
      },
    }),
    {
      name: "open-builder-conversations",
      version: CONVERSATION_STORE_VERSION,
      storage: createJSONStorage(() => localforageStorage),
      partialize: (state) => ({
        conversations: state.conversations,
        activeId: state.activeId,
      }),
      migrate: (persisted, version) =>
        migrateConversationState(persisted, version),
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Migrate old hardcoded default titles to sentinel value
          const convs = state.conversations;
          let changed = false;
          for (const id of Object.keys(convs)) {
            if (convs[id].title === "新应用" || convs[id].title === "New App") {
              convs[id] = { ...convs[id], title: DEFAULT_TITLE };
              changed = true;
            }
            const compressedContext = normalizeStoredCompressedContext(
              convs[id].compressedContext,
            );
            if (
              compressedContext?.summary !==
                convs[id].compressedContext?.summary ||
              compressedContext?.fromIndex !==
                convs[id].compressedContext?.fromIndex
            ) {
              convs[id] = { ...convs[id], compressedContext };
              changed = true;
            }
          }
          if (changed) {
            useConversationStore.setState({ conversations: { ...convs } });
          }
        }
        useConversationStore.setState({ _hasHydrated: true });
      },
    },
  ),
);
