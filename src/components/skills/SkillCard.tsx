import { useState } from "react";
import { ChevronRight, Trash2, BookOpen, Play, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { SkillEntry } from "../../lib/skills/types";
import type { SkillCatalogItem } from "../../lib/skills/catalog";
import { useT } from "../../i18n";

interface SkillCardProps {
  skill: SkillEntry;
  catalog?: Omit<SkillCatalogItem, "skill">;
  onToggleAutoEnabled: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  pending?: boolean;
  details?: {
    references: string[];
    scripts: string[];
  };
  onRequestDetails?: (id: string) => void;
}

export function SkillCard({
  skill,
  catalog,
  onToggleAutoEnabled,
  onDelete,
  pending = false,
  details,
  onRequestDetails,
}: SkillCardProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const isBuiltin = skill.source === "builtin";

  const toggleExpand = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !details && onRequestDetails) {
      onRequestDetails(skill.id);
    }
  };

  return (
    <div className="border border-border/60 rounded-lg overflow-hidden bg-muted/30">
      <div className="flex items-start gap-3 p-3">
        <Switch
          checked={skill.autoEnabled}
          disabled={pending}
          onCheckedChange={(next) => onToggleAutoEnabled(skill.id, next)}
          aria-label={
            skill.autoEnabled
              ? t.skills.disableAutoMatch
              : t.skills.enableAutoMatch
          }
          className="mt-0.5"
        />
        {pending && (
          <Loader2
            size={13}
            className="mt-1 animate-spin text-muted-foreground"
            aria-label={t.skills.updating}
          />
        )}
        <button
          type="button"
          onClick={toggleExpand}
          aria-label={expanded ? t.skills.closeDetails : t.skills.details}
          aria-expanded={expanded}
          className="flex-1 min-w-0 text-left"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{skill.name}</span>
            <Badge
              variant={isBuiltin ? "secondary" : "outline"}
              className="text-[10px] h-4 px-1.5"
            >
              {isBuiltin ? t.skills.builtIn : t.skills.imported}
            </Badge>
            <span className="text-[10px] text-muted-foreground font-mono">
              v{skill.version}
            </span>
            {skill.availableVersion &&
              skill.cachedVersion &&
              skill.availableVersion !== skill.cachedVersion && (
                <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                  {t.skills.updateAvailable}
                </Badge>
              )}
            {catalog && (
              <Badge
                variant={
                  catalog.risk === "high"
                    ? "destructive"
                    : catalog.risk === "medium"
                      ? "outline"
                      : "secondary"
                }
                className="text-[10px] h-4 px-1.5"
              >
                {catalog.risk === "high"
                  ? t.skills.market.riskHigh
                  : catalog.risk === "medium"
                    ? t.skills.market.riskMedium
                    : t.skills.market.riskLow}
              </Badge>
            )}
            <ChevronRight
              size={13}
              className={cn(
                "ml-auto text-muted-foreground transition-transform shrink-0",
                expanded && "rotate-90",
              )}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
            {skill.description}
          </p>
          {catalog && (
            <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
              <span>
                {t.skills.market.permissions}: {catalog.permissionCount}
              </span>
              <span>
                {t.skills.market.scripts}: {catalog.scriptCount}
              </span>
              <span>
                {t.skills.market.references}: {catalog.referenceCount}
              </span>
              <span>{new Date(skill.installedAt).toLocaleDateString()}</span>
            </div>
          )}
        </button>
        <TooltipIconButton
          type="button"
          size="icon"
          variant="ghost"
          className="w-7 h-7 text-muted-foreground hover:text-destructive disabled:opacity-30"
          label={isBuiltin ? t.skills.builtinCantDelete : t.skills.delete}
          disabled={isBuiltin}
          onClick={() => onDelete(skill.id)}
        >
          <Trash2 size={14} />
        </TooltipIconButton>
      </div>
      {expanded && (
        <div className="border-t border-border/60 px-3 py-2 bg-muted/30 text-xs space-y-2">
          {skill.allowedTools && skill.allowedTools.length > 0 && (
            <div>
              <span className="text-muted-foreground">
                {t.skills.allowedTools}:{" "}
              </span>
              <span className="font-mono">{skill.allowedTools.join(", ")}</span>
            </div>
          )}
          {skill.tags && skill.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {skill.tags.map((tag) => (
                <Badge
                  key={tag}
                  variant="outline"
                  className="text-[10px] h-4 px-1.5"
                >
                  {tag}
                </Badge>
              ))}
            </div>
          )}
          {details && details.references.length > 0 && (
            <div className="flex items-start gap-1.5">
              <BookOpen size={12} className="text-indigo-500 mt-0.5 shrink-0" />
              <div className="flex-1">
                <span className="text-muted-foreground">
                  {t.skills.references}:{" "}
                </span>
                <span className="font-mono">
                  {details.references.join(", ")}
                </span>
              </div>
            </div>
          )}
          {details && details.scripts.length > 0 && (
            <div className="flex items-start gap-1.5">
              <Play size={12} className="text-indigo-500 mt-0.5 shrink-0" />
              <div className="flex-1">
                <span className="text-muted-foreground">
                  {t.skills.scripts}:{" "}
                </span>
                <span className="font-mono">{details.scripts.join(", ")}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
