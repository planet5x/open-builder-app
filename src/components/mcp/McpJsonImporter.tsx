import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, FileJson2, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "../../i18n";
import type { McpImportCandidate, McpImportPreview } from "../../lib/mcp/types";

interface McpJsonImporterProps {
  onPreview: (source: string) => Promise<McpImportPreview> | McpImportPreview;
  onApply: (preview: McpImportPreview) => Promise<number> | number;
  onImported?: () => void;
}

function withCandidateAction(
  preview: McpImportPreview,
  index: number,
  action: McpImportCandidate["action"],
): McpImportPreview {
  return {
    ...preview,
    candidates: preview.candidates.map((candidate, candidateIndex) =>
      candidateIndex === index ? { ...candidate, action } : candidate,
    ),
  };
}

export function McpJsonImporter({
  onPreview,
  onApply,
  onImported,
}: McpJsonImporterProps) {
  const t = useT();
  const [source, setSource] = useState("");
  const [preview, setPreview] = useState<McpImportPreview | null>(null);
  const [phase, setPhase] = useState<"idle" | "previewing" | "applying">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const importCount = useMemo(
    () =>
      preview?.candidates.filter(
        (candidate) => candidate.valid && candidate.action !== "skip",
      ).length ?? 0,
    [preview],
  );

  const handlePreview = async () => {
    if (!source.trim() || phase !== "idle") return;
    setPhase("previewing");
    setError(null);
    setSuccess(null);
    try {
      setPreview(await onPreview(source));
    } catch (reason: unknown) {
      setPreview(null);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPhase("idle");
    }
  };

  const handleApply = async () => {
    if (!preview || importCount === 0 || phase !== "idle") return;
    setPhase("applying");
    setError(null);
    setSuccess(null);
    try {
      const count = await onApply(preview);
      setSuccess(t.mcp.importer.success.replace("{count}", String(count)));
      onImported?.();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPhase("idle");
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{t.mcp.editor.json}</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t.mcp.importer.hint}
        </p>
      </div>

      <Textarea
        value={source}
        rows={8}
        disabled={phase !== "idle"}
        spellCheck={false}
        aria-label={t.mcp.editor.json}
        className="resize-y font-mono text-xs leading-relaxed"
        placeholder={t.mcp.importer.placeholder}
        onChange={(event) => {
          setSource(event.target.value);
          setPreview(null);
          setError(null);
          setSuccess(null);
        }}
      />

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {preview && (
          <Button
            type="button"
            disabled={phase !== "idle" || importCount === 0}
            onClick={handleApply}
          >
            {phase === "applying" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <FileJson2 size={14} />
            )}
            {phase === "applying"
              ? t.mcp.importer.applying
              : t.mcp.importer.apply.replace("{count}", String(importCount))}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          disabled={!source.trim() || phase !== "idle"}
          onClick={handlePreview}
        >
          {phase === "previewing" && (
            <Loader2 size={14} className="animate-spin" />
          )}
          {phase === "previewing"
            ? t.mcp.importer.previewing
            : t.mcp.importer.preview}
        </Button>
      </div>

      {preview && preview.issues.length > 0 && (
        <div
          role={
            preview.issues.some((issue) => issue.severity === "error")
              ? "alert"
              : "status"
          }
          className="space-y-1 rounded-md border border-border/70 bg-background/70 p-2.5 text-[11px] leading-relaxed"
        >
          {preview.issues.map((issue, index) => (
            <p
              key={`${issue.path}-${issue.code}-${index}`}
              className={
                issue.severity === "error"
                  ? "text-destructive"
                  : "text-amber-800 dark:text-amber-300"
              }
            >
              {issue.path}: {issue.message}
            </p>
          ))}
        </div>
      )}

      {preview && (
        <div className="overflow-hidden rounded-md border border-border/70 bg-background/70">
          {preview.candidates.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">
              {t.mcp.importer.noEntries}
            </p>
          ) : (
            <div className="divide-y divide-border/60">
              {preview.candidates.map((candidate, index) => {
                const errors = candidate.issues.filter(
                  (issue) => issue.severity === "error",
                );
                const warnings = candidate.issues.filter(
                  (issue) => issue.severity === "warning",
                );
                return (
                  <div
                    key={`${candidate.name}-${index}`}
                    className="space-y-2 p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      {candidate.valid ? (
                        <CheckCircle2
                          size={15}
                          className="text-emerald-600 dark:text-emerald-400"
                          aria-hidden="true"
                        />
                      ) : (
                        <AlertTriangle
                          size={15}
                          className="text-destructive"
                          aria-hidden="true"
                        />
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {candidate.name}
                      </span>
                      {candidate.config && (
                        <Badge
                          variant="outline"
                          className="font-mono text-[10px]"
                        >
                          {candidate.config.transport}
                        </Badge>
                      )}
                      <Badge
                        variant={candidate.valid ? "secondary" : "destructive"}
                        className="text-[10px]"
                      >
                        {candidate.valid
                          ? t.mcp.importer.valid
                          : t.mcp.importer.invalid}
                      </Badge>
                    </div>

                    {candidate.conflict === "existing" && candidate.valid && (
                      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
                        <span className="text-xs text-muted-foreground">
                          {t.mcp.importer.conflict}
                        </span>
                        <Select
                          value={candidate.action}
                          onValueChange={(action) =>
                            setPreview((current) =>
                              current
                                ? withCandidateAction(
                                    current,
                                    index,
                                    action as McpImportCandidate["action"],
                                  )
                                : current,
                            )
                          }
                        >
                          <SelectTrigger
                            size="sm"
                            className="w-full sm:w-52"
                            aria-label={`${t.mcp.importer.conflict}: ${candidate.name}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="skip">
                              {t.mcp.importer.skip}
                            </SelectItem>
                            <SelectItem value="replace">
                              {t.mcp.importer.replace}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {(errors.length > 0 || warnings.length > 0) && (
                      <div className="space-y-1 text-[11px] leading-relaxed">
                        {errors.map((issue, issueIndex) => (
                          <p
                            key={`error-${issue.path}-${issueIndex}`}
                            className="text-destructive"
                          >
                            {issue.path}: {issue.message}
                          </p>
                        ))}
                        {warnings.map((issue, issueIndex) => (
                          <p
                            key={`warning-${issue.path}-${issueIndex}`}
                            className="text-amber-800 dark:text-amber-300"
                          >
                            {issue.path}: {issue.message}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive"
        >
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <p className="whitespace-pre-wrap">{error}</p>
        </div>
      )}
      {success && (
        <div
          role="status"
          className="flex gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-xs text-emerald-700 dark:text-emerald-300"
        >
          <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
          <p>{success}</p>
        </div>
      )}
    </div>
  );
}
