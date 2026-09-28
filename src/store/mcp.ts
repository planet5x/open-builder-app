import localforage from "localforage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  approveMcpDiscovery,
  compareMcpDiscovery,
  type ApproveMcpDiscoveryOptions,
} from "../lib/mcp/fingerprint";
import { TOOL_POLICY_VERSION } from "../lib/ai/tool-policy-version";
import { MCP_LIMITS } from "../lib/mcp/limits";
import { redactMcpError } from "../lib/mcp/redaction";
import type {
  McpServerDiscovery,
  McpServerEntry,
  McpServerRuntimeState,
  McpToolApproval,
} from "../lib/mcp/types";
import {
  assertMcpToolLimit,
  McpValidationError,
  sanitizeMcpToolPermissions,
  validateMcpServerEntry,
} from "../lib/mcp/validation";
import { createLocalforageStorage } from "./utils/localforage-storage";
import {
  captureMcpLifecycleEpoch,
  isMcpLifecycleCurrent,
} from "../lib/mcp/revocation";

export const MCP_STORE_VERSION = 2;

type McpServerPatch = Partial<
  Omit<McpServerEntry, "id" | "createdAt" | "tools">
>;

type McpToolApprovalPatch = Partial<
  Pick<McpToolApproval, "enabled" | "allowInPlanMode" | "allowForSubagents">
>;

type McpRuntimePatch = Partial<Omit<McpServerRuntimeState, "updatedAt">> & {
  updatedAt?: number;
};

export interface McpState {
  /** Optional master switch. Per-server `enabled` remains the primary UI control. */
  globalEnabled: boolean;
  servers: Record<string, McpServerEntry>;
  /** Session-only connection state; excluded from persisted storage. */
  runtime: Record<string, McpServerRuntimeState>;
  _hasHydrated: boolean;

  registerServer: (entry: McpServerEntry) => void;
  updateServer: (id: string, patch: McpServerPatch) => void;
  deleteServer: (id: string) => void;
  replaceServers: (servers: Record<string, McpServerEntry>) => void;
  setGlobalEnabled: (enabled: boolean) => void;
  setServerEnabled: (id: string, enabled: boolean) => void;
  setToolApproval: (
    serverId: string,
    toolName: string,
    patch: McpToolApprovalPatch,
  ) => void;
  approveServer: (
    serverId: string,
    discovery: McpServerDiscovery,
    options?: ApproveMcpDiscoveryOptions,
  ) => Promise<McpServerEntry>;
  setRuntimeState: (serverId: string, patch: McpRuntimePatch) => void;
  clearRuntimeState: (serverId: string) => void;
  clearAllRuntime: () => void;

  getServer: (id: string) => McpServerEntry | undefined;
  listServers: () => McpServerEntry[];
}

function assertUniqueName(
  servers: Record<string, McpServerEntry>,
  name: string,
  exceptId?: string,
): void {
  const normalized = name.trim().toLowerCase();
  if (
    Object.values(servers).some(
      (server) =>
        server.id !== exceptId &&
        server.name.trim().toLowerCase() === normalized,
    )
  ) {
    throw new McpValidationError([
      {
        path: "name",
        code: "duplicate",
        message: `An MCP server named "${name}" already exists.`,
      },
    ]);
  }
}

function assertServerSet(servers: Record<string, McpServerEntry>): void {
  if (Object.keys(servers).length > MCP_LIMITS.maxServers) {
    throw new McpValidationError([
      {
        path: "servers",
        code: "too_many",
        message: `At most ${MCP_LIMITS.maxServers} MCP servers are allowed.`,
      },
    ]);
  }
  const names = new Set<string>();
  for (const [id, server] of Object.entries(servers)) {
    if (id !== server.id) {
      throw new McpValidationError([
        {
          path: `servers.${id}`,
          code: "id_mismatch",
          message: "Server record key must match its id.",
        },
      ]);
    }
    const validation = validateMcpServerEntry(server);
    if (!validation.valid) throw new McpValidationError(validation.errors);
    const name = server.name.trim().toLowerCase();
    if (names.has(name)) {
      throw new McpValidationError([
        {
          path: `servers.${id}.name`,
          code: "duplicate",
          message: `Duplicate MCP server name "${server.name}".`,
        },
      ]);
    }
    names.add(name);
  }
  assertMcpToolLimit(servers);
}

const mcpStorage = createLocalforageStorage(
  localforage.createInstance({ name: "open-builder-mcp" }),
);

export const useMcpStore = create<McpState>()(
  persist(
    (set, get) => ({
      globalEnabled: true,
      servers: {},
      runtime: {},
      _hasHydrated: false,

      registerServer: (entry) => {
        const validation = validateMcpServerEntry(entry);
        if (!validation.valid) throw new McpValidationError(validation.errors);
        const current = get().servers;
        if (current[entry.id]) {
          throw new McpValidationError([
            {
              path: "id",
              code: "duplicate",
              message: `MCP server id "${entry.id}" already exists.`,
            },
          ]);
        }
        assertUniqueName(current, entry.name);
        const servers = { ...current, [entry.id]: entry };
        assertServerSet(servers);
        set({ servers });
      },

      updateServer: (id, patch) => {
        const existing = get().servers[id];
        if (!existing) throw new Error(`Unknown MCP server "${id}".`);
        const updated: McpServerEntry = {
          ...existing,
          ...patch,
          id,
          createdAt: existing.createdAt,
          tools: existing.tools,
          updatedAt: patch.updatedAt ?? Date.now(),
        };
        const validation = validateMcpServerEntry(updated);
        if (!validation.valid) throw new McpValidationError(validation.errors);
        assertUniqueName(get().servers, updated.name, id);
        const servers = { ...get().servers, [id]: updated };
        assertMcpToolLimit(servers);
        set((state) => {
          const { [id]: _removed, ...remainingRuntime } = state.runtime;
          return { servers, runtime: remainingRuntime };
        });
      },

      deleteServer: (id) =>
        set((state) => {
          if (!state.servers[id]) return state;
          const { [id]: _server, ...servers } = state.servers;
          const { [id]: _runtime, ...runtime } = state.runtime;
          return { servers, runtime };
        }),

      replaceServers: (servers) => {
        assertServerSet(servers);
        set({ servers, runtime: {} });
      },

      setGlobalEnabled: (globalEnabled) => {
        if (globalEnabled) assertMcpToolLimit(get().servers);
        set({ globalEnabled });
      },

      setServerEnabled: (id, enabled) => {
        const existing = get().servers[id];
        if (!existing) throw new Error(`Unknown MCP server "${id}".`);
        const servers = {
          ...get().servers,
          [id]: { ...existing, enabled, updatedAt: Date.now() },
        };
        assertMcpToolLimit(servers);
        set((state) => ({
          servers,
          ...(!enabled
            ? {
                runtime: {
                  ...state.runtime,
                  [id]: {
                    status: "idle" as const,
                    updatedAt: Date.now(),
                  },
                },
              }
            : {}),
        }));
      },

      setToolApproval: (serverId, toolName, patch) => {
        const server = get().servers[serverId];
        if (!server) throw new Error(`Unknown MCP server "${serverId}".`);
        const tool = server.tools[toolName];
        if (!tool) throw new Error(`Unknown MCP tool "${toolName}".`);
        const currentPermissions =
          tool.elevatedPermissionsPolicyVersion === TOOL_POLICY_VERSION
            ? tool
            : {
                ...tool,
                allowInPlanMode: false,
                allowForSubagents: false,
                elevatedPermissionsPolicyVersion: undefined,
              };
        const updatedTool = sanitizeMcpToolPermissions({
          ...currentPermissions,
          ...patch,
          elevatedPermissionsPolicyVersion:
            patch.allowInPlanMode === true || patch.allowForSubagents === true
              ? TOOL_POLICY_VERSION
              : currentPermissions.elevatedPermissionsPolicyVersion,
        });
        if (!updatedTool.allowInPlanMode && !updatedTool.allowForSubagents) {
          updatedTool.elevatedPermissionsPolicyVersion = undefined;
        }
        const updatedServer: McpServerEntry = {
          ...server,
          tools: { ...server.tools, [toolName]: updatedTool },
          updatedAt: Date.now(),
        };
        const servers = { ...get().servers, [serverId]: updatedServer };
        assertMcpToolLimit(servers);
        set({ servers });
      },

      approveServer: async (serverId, discovery, options) => {
        const current = get().servers[serverId];
        if (!current) throw new Error(`Unknown MCP server "${serverId}".`);
        const approved = await approveMcpDiscovery(current, discovery, options);
        const latest = get().servers[serverId];
        if (!latest)
          throw new Error(
            `MCP server "${serverId}" was deleted during approval.`,
          );
        const merged: McpServerEntry = {
          ...approved,
          // Preserve config edits made while async fingerprints were calculated.
          name: latest.name,
          transport: latest.transport,
          url: latest.url,
          headers: latest.headers,
          oauth: latest.oauth,
          command: latest.command,
          args: latest.args,
          env: latest.env,
          cwd: latest.cwd,
          requestTimeoutMs: latest.requestTimeoutMs,
        };
        const servers = { ...get().servers, [serverId]: merged };
        assertMcpToolLimit(servers);
        const drift = await compareMcpDiscovery(merged, discovery);
        set({
          servers,
          runtime: {
            ...get().runtime,
            [serverId]: {
              status: "ready",
              instructions: discovery.instructions,
              tools: discovery.tools,
              drift,
              updatedAt: Date.now(),
            },
          },
        });
        return merged;
      },

      setRuntimeState: (serverId, patch) => {
        if (!get().servers[serverId]) return;
        const existing = get().runtime[serverId];
        const status = patch.status ?? existing?.status ?? "idle";
        const next: McpServerRuntimeState = {
          ...existing,
          ...patch,
          status,
          ...(patch.error !== undefined
            ? { error: redactMcpError(patch.error) }
            : {}),
          updatedAt: patch.updatedAt ?? Date.now(),
        };
        set((state) => ({
          runtime: { ...state.runtime, [serverId]: next },
        }));
      },

      clearRuntimeState: (serverId) =>
        set((state) => {
          const { [serverId]: _removed, ...runtime } = state.runtime;
          return { runtime };
        }),

      clearAllRuntime: () => set({ runtime: {} }),

      getServer: (id) => get().servers[id],
      listServers: () => Object.values(get().servers),
    }),
    {
      name: "open-builder-mcp",
      version: MCP_STORE_VERSION,
      storage: createJSONStorage(() => mcpStorage),
      partialize: (state) => ({
        globalEnabled: state.globalEnabled,
        servers: state.servers,
      }),
      migrate: (persisted) => {
        const value = persisted as Partial<McpState> | undefined;
        const servers = Object.fromEntries(
          Object.entries(value?.servers ?? {}).map(([serverId, server]) => [
            serverId,
            {
              ...server,
              tools: Object.fromEntries(
                Object.entries(server.tools).map(([toolName, tool]) => [
                  toolName,
                  tool.elevatedPermissionsPolicyVersion === TOOL_POLICY_VERSION
                    ? tool
                    : {
                        ...tool,
                        allowInPlanMode: false,
                        allowForSubagents: false,
                        elevatedPermissionsPolicyVersion: undefined,
                      },
                ]),
              ),
            },
          ]),
        );
        return {
          globalEnabled: value?.globalEnabled ?? true,
          servers,
        };
      },
      onRehydrateStorage: () => {
        let hydrationEpoch: number | undefined;
        try {
          hydrationEpoch = captureMcpLifecycleEpoch();
        } catch {
          // A hydration that starts during full clear must not repopulate MCP.
        }
        return () => {
          const stale =
            hydrationEpoch === undefined ||
            !isMcpLifecycleCurrent(hydrationEpoch);
          useMcpStore.setState(
            stale
              ? {
                  globalEnabled: true,
                  servers: {},
                  runtime: {},
                  _hasHydrated: true,
                }
              : { runtime: {}, _hasHydrated: true },
          );
        };
      },
    },
  ),
);
