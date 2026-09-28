import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleOff,
  KeyRound,
  Loader2,
  Pencil,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useT } from "../../i18n";
import type {
  McpConnectionStatus,
  McpServerEntry,
  McpServerRuntimeState,
  McpToolApproval,
  McpToolDefinition,
} from "../../lib/mcp/types";
import { hasCurrentMcpElevatedPermission } from "../../lib/mcp/validation";

interface McpServerCardProps {
  server: McpServerEntry;
  runtime?: McpServerRuntimeState;
  pending?: boolean;
  onToggleServer: (serverId: string, enabled: boolean) => void;
  onSetToolApproval: (
    serverId: string,
    toolName: string,
    patch: Partial<
      Pick<McpToolApproval, "enabled" | "allowInPlanMode" | "allowForSubagents">
    >,
  ) => void;
  onTest?: (serverId: string) => void;
  onReconnect?: (serverId: string) => void;
  onAuthorize?: (serverId: string) => void;
  onReview?: (serverId: string) => void;
  onEdit: (serverId: string) => void;
  onDelete: (serverId: string) => void;
}

function displayEndpoint(server: McpServerEntry): string {
  if (server.transport === "stdio") return server.command ?? "stdio";
  if (!server.url) return "";
  try {
    const url = new URL(server.url);
    return `${url.origin}${url.pathname}`;
  } catch {
    return server.url.split(/[?#]/, 1)[0];
  }
}

function transportLabel(
  server: McpServerEntry,
  labels: {
    streamableHttp: string;
    sse: string;
    stdio: string;
  },
): string {
  if (server.transport === "stdio") return labels.stdio;
  if (server.transport === "sse") return labels.sse;
  return labels.streamableHttp;
}

function toolLabel(tool: McpToolDefinition): string {
  return tool.title?.trim() || tool.annotations?.title?.trim() || tool.name;
}

export function McpServerCard({
  server,
  runtime,
  pending = false,
  onToggleServer,
  onSetToolApproval,
  onTest,
  onReconnect,
  onAuthorize,
  onReview,
  onEdit,
  onDelete,
}: McpServerCardProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const status: McpConnectionStatus = runtime?.status ?? "idle";
  const drift = runtime?.drift;
  const needsReview =
    status === "drifted" ||
    drift?.status === "drifted" ||
    drift?.status === "unapproved";
  const displayStatus: McpConnectionStatus = needsReview ? "drifted" : status;
  const approvedTools = useMemo(
    () => Object.values(server.tools),
    [server.tools],
  );
  const displayTools = useMemo<McpToolDefinition[]>(() => {
    if (needsReview && runtime?.tools) return runtime.tools;
    return approvedTools;
  }, [approvedTools, needsReview, runtime?.tools]);
  const enabledToolCount = approvedTools.filter((tool) => tool.enabled).length;
  const isConnecting = status === "connecting" || pending;
  const instructions =
    needsReview && runtime?.instructions !== undefined
      ? runtime.instructions
      : server.instructions;

  const statusView = {
    idle: {
      label: t.mcp.status.idle,
      icon: CircleOff,
      className: "text-muted-foreground",
      badge: "outline" as const,
    },
    connecting: {
      label: t.mcp.status.connecting,
      icon: Loader2,
      className: "text-muted-foreground animate-spin",
      badge: "outline" as const,
    },
    needs_auth: {
      label: t.mcp.status.needs_auth,
      icon: KeyRound,
      className: "text-amber-700 dark:text-amber-300",
      badge: "outline" as const,
    },
    ready: {
      label: t.mcp.status.ready,
      icon: CheckCircle2,
      className: "text-emerald-600 dark:text-emerald-400",
      badge: "secondary" as const,
    },
    error: {
      label: t.mcp.status.error,
      icon: AlertTriangle,
      className: "text-destructive",
      badge: "destructive" as const,
    },
    drifted: {
      label: t.mcp.status.drifted,
      icon: ShieldAlert,
      className: "text-amber-700 dark:text-amber-300",
      badge: "outline" as const,
    },
  }[displayStatus];
  const StatusIcon = statusView.icon;

  return (
    <article className="overflow-hidden rounded-lg border border-border/70 bg-muted/20">
      <div className="flex items-start gap-3 p-3">
        <Switch
          checked={server.enabled}
          disabled={pending || needsReview}
          onCheckedChange={(enabled) => onToggleServer(server.id, enabled)}
          aria-label={(server.enabled
            ? t.mcp.disableServer
            : t.mcp.enableServer
          ).replace("{name}", server.name)}
          className="mt-0.5"
        />

        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-label={expanded ? t.mcp.close : t.mcp.details}
          aria-expanded={expanded}
          className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="min-w-0 max-w-full truncate text-sm font-medium">
              {server.name}
            </span>
            <Badge variant="outline" className="h-5 font-mono text-[10px]">
              {transportLabel(server, t.mcp.transport)}
            </Badge>
            <Badge variant={statusView.badge} className="h-5 gap-1 text-[10px]">
              <StatusIcon
                size={11}
                className={statusView.className}
                aria-hidden="true"
              />
              {statusView.label}
            </Badge>
            <ChevronRight
              size={14}
              className={cn(
                "ml-auto shrink-0 text-muted-foreground transition-transform",
                expanded && "rotate-90",
              )}
              aria-hidden="true"
            />
          </span>
          <span className="mt-1 block truncate font-mono text-[11px] text-muted-foreground">
            {displayEndpoint(server)}
          </span>
          <span className="mt-1 block text-[11px] text-muted-foreground">
            {t.mcp.toolsSummary
              .replace("{enabled}", String(enabledToolCount))
              .replace("{total}", String(approvedTools.length))}
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-0.5">
          {status === "needs_auth" && onAuthorize && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              disabled={isConnecting}
              aria-label={`${t.mcp.authorize}: ${server.name}`}
              onClick={() => onAuthorize(server.id)}
            >
              <KeyRound size={13} />
              <span className="hidden sm:inline">{t.mcp.authorize}</span>
            </Button>
          )}
          {needsReview && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              aria-label={`${t.mcp.review}: ${server.name}`}
              onClick={() => setExpanded(true)}
            >
              <ShieldAlert size={13} />
              <span className="hidden sm:inline">{t.mcp.review}</span>
            </Button>
          )}
          {!needsReview &&
          (status === "ready" || status === "error") &&
          onReconnect ? (
            <TooltipIconButton
              type="button"
              size="icon"
              variant="ghost"
              className="size-7 text-muted-foreground hover:text-foreground"
              disabled={isConnecting}
              label={`${t.mcp.refresh}: ${server.name}`}
              onClick={() => onReconnect(server.id)}
            >
              {isConnecting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
            </TooltipIconButton>
          ) : (
            !needsReview &&
            status === "idle" &&
            onTest && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                disabled={isConnecting}
                aria-label={`${t.mcp.test}: ${server.name}`}
                onClick={() => onTest(server.id)}
              >
                {isConnecting ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <RefreshCw size={13} />
                )}
                <span className="hidden sm:inline">
                  {isConnecting ? t.mcp.testing : t.mcp.test}
                </span>
              </Button>
            )
          )}
          <TooltipIconButton
            type="button"
            size="icon"
            variant="ghost"
            className="size-7 text-muted-foreground hover:text-foreground"
            label={`${t.mcp.edit}: ${server.name}`}
            disabled={pending}
            onClick={() => onEdit(server.id)}
          >
            <Pencil size={14} />
          </TooltipIconButton>
          <TooltipIconButton
            type="button"
            size="icon"
            variant="ghost"
            className="size-7 text-muted-foreground hover:text-destructive"
            label={`${t.mcp.delete}: ${server.name}`}
            disabled={pending}
            onClick={() => onDelete(server.id)}
          >
            <Trash2 size={14} />
          </TooltipIconButton>
        </div>
      </div>

      {needsReview && (
        <div
          role="status"
          className="border-t border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300"
        >
          <p>{t.mcp.server.changed}</p>
          {drift && (
            <div className="mt-1.5 space-y-1 text-[11px]">
              {drift.added.length > 0 && (
                <p>
                  <span className="font-medium">{t.mcp.server.added}: </span>
                  <span className="font-mono break-words">
                    {drift.added.join(", ")}
                  </span>
                </p>
              )}
              {drift.removed.length > 0 && (
                <p>
                  <span className="font-medium">{t.mcp.server.removed}: </span>
                  <span className="font-mono break-words">
                    {drift.removed.join(", ")}
                  </span>
                </p>
              )}
              {drift.changed.length > 0 && (
                <p>
                  <span className="font-medium">{t.mcp.server.modified}: </span>
                  <span className="font-mono break-words">
                    {drift.changed.join(", ")}
                  </span>
                </p>
              )}
              {drift.instructionsChanged && (
                <p className="font-medium">{t.mcp.server.instructions}</p>
              )}
            </div>
          )}
        </div>
      )}

      {runtime?.error && (
        <div
          role="alert"
          className="flex gap-2 border-t border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium">{t.mcp.server.errorDetails}</p>
            <p className="mt-0.5 break-words whitespace-pre-wrap">
              {runtime.error}
            </p>
          </div>
        </div>
      )}

      {expanded && (
        <div className="space-y-4 border-t border-border/60 bg-background/50 px-3 py-3">
          <section className="space-y-1.5">
            <h4 className="text-xs font-medium">{t.mcp.server.instructions}</h4>
            {instructions ? (
              <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 font-sans text-[11px] leading-relaxed text-muted-foreground">
                {instructions}
              </pre>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t.mcp.server.noInstructions}
              </p>
            )}
          </section>

          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-medium">{t.mcp.server.tools}</h4>
              <p className="text-[11px] text-muted-foreground">
                {t.mcp.tool.approvalHint}
              </p>
            </div>
            {displayTools.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t.mcp.server.noTools}
              </p>
            ) : (
              <div className="divide-y divide-border/60 overflow-hidden rounded-md border border-border/60">
                {displayTools.map((tool) => {
                  const approval = server.tools[tool.name];
                  const readOnly = tool.annotations?.readOnlyHint === true;
                  const permissionDisabled = needsReview || !approval;
                  return (
                    <div
                      key={tool.name}
                      className="space-y-2 bg-muted/20 p-2.5"
                    >
                      <div className="flex items-start gap-2">
                        <Switch
                          checked={approval?.enabled ?? false}
                          disabled={permissionDisabled}
                          onCheckedChange={(enabled) =>
                            onSetToolApproval(server.id, tool.name, { enabled })
                          }
                          aria-label={t.mcp.tool.enable.replace(
                            "{name}",
                            toolLabel(tool),
                          )}
                          className="mt-0.5"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs font-medium">
                              {toolLabel(tool)}
                            </span>
                            {tool.title && tool.title !== tool.name && (
                              <span className="font-mono text-[10px] text-muted-foreground">
                                {tool.name}
                              </span>
                            )}
                            <Badge
                              variant={readOnly ? "secondary" : "outline"}
                              className="h-4 text-[9px]"
                            >
                              {readOnly
                                ? t.mcp.tool.readOnly
                                : t.mcp.tool.writeCapable}
                            </Badge>
                          </div>
                          {tool.description && (
                            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                              {tool.description}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-x-4 gap-y-2 pl-10">
                        <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          <Switch
                            checked={
                              approval
                                ? hasCurrentMcpElevatedPermission(
                                    approval,
                                    "plan",
                                  )
                                : false
                            }
                            disabled={
                              permissionDisabled ||
                              !approval?.enabled ||
                              !readOnly
                            }
                            onCheckedChange={(allowInPlanMode) =>
                              onSetToolApproval(server.id, tool.name, {
                                allowInPlanMode,
                              })
                            }
                            aria-label={`${t.mcp.tool.plan}: ${toolLabel(tool)}`}
                          />
                          {t.mcp.tool.plan}
                        </label>
                        <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          <Switch
                            checked={
                              approval
                                ? hasCurrentMcpElevatedPermission(
                                    approval,
                                    "subagent",
                                  )
                                : false
                            }
                            disabled={
                              permissionDisabled ||
                              !approval?.enabled ||
                              !readOnly
                            }
                            onCheckedChange={(allowForSubagents) =>
                              onSetToolApproval(server.id, tool.name, {
                                allowForSubagents,
                              })
                            }
                            aria-label={`${t.mcp.tool.subagent}: ${toolLabel(tool)}`}
                          />
                          {t.mcp.tool.subagent}
                        </label>
                      </div>
                      {!readOnly && (
                        <p className="pl-10 text-[10px] text-muted-foreground">
                          {t.mcp.tool.disabledReadOnly}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {needsReview && onReview && (
            <div className="flex justify-end border-t border-border/60 pt-3">
              <Button
                type="button"
                size="sm"
                disabled={isConnecting}
                onClick={() => onReview(server.id)}
              >
                {isConnecting ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <ShieldAlert size={14} />
                )}
                {drift?.status === "unapproved"
                  ? t.mcp.approve
                  : t.mcp.approveChanges}
              </Button>
            </div>
          )}

          <p className="text-[10px] text-muted-foreground">
            {runtime?.connectedAt
              ? t.mcp.server.lastConnected.replace(
                  "{time}",
                  new Date(runtime.connectedAt).toLocaleString(),
                )
              : t.mcp.server.neverConnected}
          </p>
        </div>
      )}
    </article>
  );
}
