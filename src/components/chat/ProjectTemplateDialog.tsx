import { useEffect, useMemo, useState } from "react";
import { FileCode2, Library, Play, Save, Tag, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatBytes } from "../../lib/utils/storage-governance";
import { getProjectTemplateStats } from "../../lib/utils/project-templates";
import { useT } from "../../i18n";
import type { Conversation, ProjectTemplate } from "../../types";

export interface ProjectTemplateSaveInput {
  name: string;
  description?: string;
  tags: string[];
}

interface ProjectTemplateDialogProps {
  sourceConversation: Conversation | null;
  sourceTitle: string;
  templates: ProjectTemplate[];
  onClose: () => void;
  onSaveCurrent: (
    input: ProjectTemplateSaveInput,
  ) => { ok: true } | { ok: false; error: string };
  onCreateFromTemplate: (templateId: string) => void;
  onDeleteTemplate: (templateId: string) => void;
}

export function ProjectTemplateDialog({
  sourceConversation,
  sourceTitle,
  templates,
  onClose,
  onSaveCurrent,
  onCreateFromTemplate,
  onDeleteTemplate,
}: ProjectTemplateDialogProps) {
  const t = useT();
  const [name, setName] = useState(sourceTitle);
  const [description, setDescription] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const sourceStats = useMemo(
    () =>
      sourceConversation
        ? getProjectTemplateStats(sourceConversation)
        : { fileCount: 0, totalBytes: 0 },
    [sourceConversation],
  );
  const canSaveCurrent = sourceStats.fileCount > 0;

  useEffect(() => {
    setName(sourceTitle);
    setDescription("");
    setTagInput("");
    setNotice(null);
  }, [sourceConversation?.id, sourceTitle]);

  const handleSave = () => {
    if (!canSaveCurrent || !name.trim()) return;
    const result = onSaveCurrent({
      name,
      description,
      tags: tagInput.split(/[,，]/),
    });
    setNotice(result.ok ? t.sessions.templates.saved : result.error);
  };

  const handleDelete = (templateId: string) => {
    if (!window.confirm(t.sessions.templates.deleteConfirm)) return;
    onDeleteTemplate(templateId);
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[82vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b">
          <div className="flex items-center gap-3">
            <DialogTitle>{t.sessions.templates.title}</DialogTitle>
            <Badge variant="secondary">{templates.length}</Badge>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <section className="border-b p-4 sm:border-b-0 sm:border-r">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <Save size={15} />
              <span>{t.sessions.templates.saveCurrent}</span>
            </div>
            <div className="space-y-3">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t.sessions.templates.namePlaceholder}
                className="h-9 text-sm"
                disabled={!canSaveCurrent}
              />
              <Textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t.sessions.templates.descriptionPlaceholder}
                className="min-h-20 resize-none text-sm"
                disabled={!canSaveCurrent}
              />
              <Input
                value={tagInput}
                onChange={(event) => setTagInput(event.target.value)}
                placeholder={t.sessions.templates.tagsPlaceholder}
                className="h-9 text-sm"
                disabled={!canSaveCurrent}
              />
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <FileCode2 size={13} />
                  {sourceStats.fileCount}
                </span>
                <span>{formatBytes(sourceStats.totalBytes)}</span>
              </div>
              {!canSaveCurrent && (
                <p className="text-xs text-muted-foreground">
                  {t.sessions.templates.emptyProject}
                </p>
              )}
              {notice && (
                <p className="text-xs text-muted-foreground">{notice}</p>
              )}
              <Button
                type="button"
                className="w-full gap-2"
                onClick={handleSave}
                disabled={!canSaveCurrent || !name.trim()}
              >
                <Save size={15} />
                {t.sessions.templates.save}
              </Button>
            </div>
          </section>

          <section className="flex min-h-0 flex-col">
            <div className="flex items-center gap-2 border-b px-4 py-3 text-sm font-medium">
              <Library size={15} />
              <span>{t.sessions.templates.library}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {templates.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {t.sessions.templates.empty}
                </p>
              ) : (
                <div className="divide-y">
                  {templates.map((template) => {
                    const stats = getProjectTemplateStats(template);
                    return (
                      <div key={template.id} className="px-4 py-3">
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <div className="flex min-w-0 items-center gap-2">
                              <p className="truncate text-sm font-medium">
                                {template.name}
                              </p>
                              <Badge variant="outline" className="shrink-0">
                                {stats.fileCount}
                              </Badge>
                            </div>
                            {template.description && (
                              <p className="line-clamp-2 text-xs text-muted-foreground">
                                {template.description}
                              </p>
                            )}
                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <span>{formatBytes(stats.totalBytes)}</span>
                              <span>
                                {new Date(
                                  template.updatedAt,
                                ).toLocaleDateString()}
                              </span>
                            </div>
                            {template.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1.5">
                                {template.tags.map((tag) => (
                                  <Badge
                                    key={tag}
                                    variant="secondary"
                                    className="max-w-28 truncate"
                                  >
                                    <Tag size={11} />
                                    {tag}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <TooltipIconButton
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              label={t.sessions.templates.create}
                              onClick={() => onCreateFromTemplate(template.id)}
                            >
                              <Play size={15} />
                            </TooltipIconButton>
                            <TooltipIconButton
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              label={t.sessions.templates.delete}
                              onClick={() => handleDelete(template.id)}
                            >
                              <Trash2 size={15} />
                            </TooltipIconButton>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
