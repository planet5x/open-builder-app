import { useEffect, useMemo } from "react";
import { Loader2, Plus, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSkillsStore } from "../../../store/skills";
import { useT } from "../../../i18n";

interface SkillsMenuProps {
  selectedIds: readonly string[];
  onSelectedIdsChange: (ids: string[]) => void;
  onManage: () => void;
  initializing?: boolean;
}

export function SkillsMenu({
  selectedIds,
  onSelectedIdsChange,
  onManage,
  initializing = false,
}: SkillsMenuProps) {
  const t = useT();
  const skills = useSkillsStore((state) => state.skills);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const sortedSkills = useMemo(
    () =>
      Object.values(skills)
        .filter((skill) => skill.autoEnabled)
        .sort((a, b) => {
          if (a.source !== b.source) return a.source === "builtin" ? -1 : 1;
          return a.name.localeCompare(b.name);
        }),
    [skills],
  );

  useEffect(() => {
    if (initializing) return;
    const validIds = selectedIds.filter((id) => skills[id]?.autoEnabled);
    if (validIds.length !== selectedIds.length) {
      onSelectedIdsChange(validIds);
    }
  }, [initializing, onSelectedIdsChange, selectedIds, skills]);

  const toggleSkill = (id: string, checked: boolean) => {
    if (checked) {
      onSelectedIdsChange(Array.from(new Set([...selectedIds, id])));
    } else {
      onSelectedIdsChange(selectedIds.filter((skillId) => skillId !== id));
    }
  };

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex shrink-0">
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7 text-muted-foreground hover:text-foreground"
                aria-label={t.skills.title}
              >
                {initializing ? (
                  <Loader2
                    size={16}
                    className="animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <ScrollText size={16} aria-hidden="true" />
                )}
              </Button>
            </DropdownMenuTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent>{t.skills.title}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        side="top"
        align="start"
        className="min-w-64 max-h-72 overflow-y-auto"
      >
        <DropdownMenuLabel>{t.skills.title}</DropdownMenuLabel>
        <p className="px-2 pb-1.5 text-[11px] leading-snug text-muted-foreground">
          {t.skills.menuHint}
        </p>
        <DropdownMenuSeparator />
        {sortedSkills.length === 0 ? (
          <p
            role="status"
            className="px-3 py-3 text-center text-xs leading-relaxed text-muted-foreground"
          >
            {initializing ? t.app.loading : t.skills.emptyAutoEnabled}
          </p>
        ) : (
          sortedSkills.map((skill) => (
            <DropdownMenuCheckboxItem
              key={skill.id}
              checked={selected.has(skill.id)}
              onCheckedChange={(checked) =>
                toggleSkill(skill.id, Boolean(checked))
              }
              onSelect={(event) => event.preventDefault()}
            >
              <span className="truncate">{skill.name}</span>
            </DropdownMenuCheckboxItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onManage}>
          <Plus size={14} />
          {t.skills.manage}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
