import { useRef, useState } from "react";
import {
  FilePlus2,
  FolderTree,
  Link2,
  Loader2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "../../i18n";
import { getSkillRegistry } from "../../lib/skills/instance";
import type { ImportResult } from "../../lib/skills/importer";
import { SKILL_IMPORT_LIMITS } from "../../lib/skills/paths";
import { isTauri } from "../../lib/skills/fs";
import { createTextSkill } from "../../lib/skills/text-creator";

interface SkillImporterProps {
  onImported: (result: ImportResult) => void;
}

function formatMb(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

export function SkillImporter({ onImported }: SkillImporterProps) {
  const t = useT();
  const desktop = isTauri();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [tags, setTags] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImport = async (
    run: () => Promise<ImportResult | null>,
  ): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await run();
      if (result) onImported(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(t.skills.importer.failed.replace("{message}", message));
    } finally {
      setBusy(false);
    }
  };

  const onCreateText = async () => {
    await handleImport(async () => {
      const registry = await getSkillRegistry();
      return createTextSkill(registry, {
        name,
        description,
        instructions,
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      });
    });
  };

  const onPickZip = async (file: File) => {
    if (file.size > SKILL_IMPORT_LIMITS.maxArchiveBytes) {
      setError(
        t.skills.importer.failed.replace(
          "{message}",
          `Skill archive exceeds ${formatMb(SKILL_IMPORT_LIMITS.maxArchiveBytes)} limit.`,
        ),
      );
      return;
    }
    await handleImport(async () => {
      const [{ importFromZip }, registry] = await Promise.all([
        import("../../lib/skills/importer"),
        getSkillRegistry(),
      ]);
      return importFromZip(registry, await file.arrayBuffer());
    });
  };

  const onImportUrl = async () => {
    if (!url.trim()) return;
    await handleImport(async () => {
      const [{ importFromUrl }, registry] = await Promise.all([
        import("../../lib/skills/importer"),
        getSkillRegistry(),
      ]);
      return importFromUrl(registry, url.trim());
    });
  };

  const onPickFolder = async () => {
    await handleImport(async () => {
      const [{ importFolderViaTauri }, registry] = await Promise.all([
        import("../../lib/skills/tauri-folder-import"),
        getSkillRegistry(),
      ]);
      return importFolderViaTauri(registry);
    });
  };

  const textForm = (
    <div className="space-y-3 pt-2">
      <p className="text-xs text-muted-foreground">
        {t.skills.importer.textHint}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="skill-name">{t.skills.importer.name}</Label>
          <Input
            id="skill-name"
            value={name}
            maxLength={64}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="skill-tags">{t.skills.importer.tags}</Label>
          <Input
            id="skill-tags"
            value={tags}
            disabled={busy}
            placeholder={t.skills.importer.tagsPlaceholder}
            onChange={(event) => setTags(event.target.value)}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="skill-description">
          {t.skills.importer.description}
        </Label>
        <Input
          id="skill-description"
          value={description}
          maxLength={512}
          disabled={busy}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="skill-instructions">
          {t.skills.importer.instructions}
        </Label>
        <Textarea
          id="skill-instructions"
          value={instructions}
          rows={7}
          disabled={busy}
          className="resize-y font-mono text-xs leading-relaxed"
          onChange={(event) => setInstructions(event.target.value)}
        />
      </div>
      <Button
        type="button"
        disabled={
          busy ||
          !name.trim() ||
          !description.trim() ||
          !instructions.trim()
        }
        onClick={onCreateText}
      >
        {busy ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <FilePlus2 size={14} />
        )}
        {busy ? t.skills.importer.importing : t.skills.importer.createText}
      </Button>
    </div>
  );

  return (
    <div className="space-y-3">
      {desktop ? (
        <Tabs defaultValue="text">
          <TabsList className="w-full">
            <TabsTrigger value="text" disabled={busy}>
              {t.skills.importer.tabs.text}
            </TabsTrigger>
            <TabsTrigger value="zip" disabled={busy}>
              {t.skills.importer.tabs.zip}
            </TabsTrigger>
            <TabsTrigger value="url" disabled={busy}>
              {t.skills.importer.tabs.url}
            </TabsTrigger>
            <TabsTrigger value="folder" disabled={busy}>
              {t.skills.importer.tabs.folder}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="text">{textForm}</TabsContent>
          <TabsContent value="zip" className="space-y-2 pt-2">
            <p className="text-xs text-muted-foreground">
              {t.skills.importer.zipHint}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onPickZip(file);
                event.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              {busy ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Upload size={14} />
              )}
              {busy ? t.skills.importer.importing : t.skills.importer.pickZip}
            </Button>
          </TabsContent>
          <TabsContent value="url" className="space-y-2 pt-2">
            <p className="text-xs text-muted-foreground">
              {t.skills.importer.urlHint}
            </p>
            <div className="flex gap-2">
              <Input
                type="url"
                aria-label={t.skills.importer.urlImport}
                placeholder={t.skills.importer.urlPlaceholder}
                value={url}
                disabled={busy}
                onChange={(event) => setUrl(event.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                disabled={busy || !url.trim()}
                onClick={onImportUrl}
              >
                {busy ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Link2 size={14} />
                )}
                {busy
                  ? t.skills.importer.importing
                  : t.skills.importer.urlImport}
              </Button>
            </div>
          </TabsContent>
          <TabsContent value="folder" className="space-y-2 pt-2">
            <p className="text-xs text-muted-foreground">
              {t.skills.importer.folderHint}
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onPickFolder}
            >
              {busy ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <FolderTree size={14} />
              )}
              {busy
                ? t.skills.importer.importing
                : t.skills.importer.pickFolder}
            </Button>
          </TabsContent>
        </Tabs>
      ) : (
        textForm
      )}
      {error && (
        <p
          role="alert"
          className="text-xs text-destructive whitespace-pre-wrap"
        >
          {error}
        </p>
      )}
    </div>
  );
}
