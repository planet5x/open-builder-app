import {
  lazy,
  Suspense,
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import { X } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "../../i18n";
import { useSettingsStore } from "../../store/settings";
import { useSkillsStore } from "../../store/skills";
import type { Attachment } from "../../types";
import type { Message } from "../../lib/ai/generator-types";
import {
  SLASH_COMMANDS,
  SlashCommandMenu,
  type SlashCommand,
} from "./chat-input/SlashCommandMenu";
import { AttachmentPreview } from "./chat-input/AttachmentPreview";
import { ChatInputToolbar } from "./chat-input/ChatInputToolbar";
import { isSkillsAvailable } from "../../lib/skills/fs";
import { getSkillRegistry } from "../../lib/skills/instance";
import {
  formatAttachmentBytes,
  isAcceptedFileMime,
  isImageMime,
  validateAttachmentFile,
} from "../../lib/utils/attachments";
import {
  deleteAttachment,
  storeAttachmentFile,
} from "../../lib/attachments/store";
import type { Translations } from "../../i18n";
import type {
  ProjectImportCommitResult,
  StagedProjectImport,
} from "../../lib/utils/project-import";

const SkillsPanel = lazy(() =>
  import("../skills/SkillsPanel").then((module) => ({
    default: module.SkillsPanel,
  })),
);
const McpPanel = lazy(() =>
  import("../mcp/McpPanel").then((module) => ({ default: module.McpPanel })),
);
const ProjectImportDialog = lazy(() =>
  import("./ProjectImportDialog").then((module) => ({
    default: module.ProjectImportDialog,
  })),
);

const NEEDS_MESSAGES = new Set([
  "fork",
  "compact",
  "health",
  "review",
  "continue",
  "retry",
]);

const FILE_ACCEPT =
  "text/*,application/json,application/xml,application/javascript,application/xhtml+xml,application/x-yaml,application/sql,application/graphql,application/ld+json,application/x-sh,application/x-httpd-php,application/typescript,application/pdf,.txt,.md,.mdx,.json,.xml,.js,.jsx,.ts,.tsx,.yaml,.yml,.sql,.graphql,.gql,.sh,.php,.css,.scss,.html,.pdf";

interface ChatInputProps {
  input: string;
  onChange: (value: string) => void;
  onSubmit: (e: React.SyntheticEvent<HTMLFormElement>) => void;
  onStop: () => void;
  isGenerating: boolean;
  messages: Message[];
  attachments: Attachment[];
  onAttachmentsChange: (attachments: Attachment[]) => void;
  onImportProject: (
    project: StagedProjectImport,
  ) => Promise<ProjectImportCommitResult> | ProjectImportCommitResult;
  hasExistingProject: boolean;
  onSlashCommand: (cmd: string) => void;
  forcedSkillIds: readonly string[];
  onForcedSkillIdsChange: (ids: string[]) => void;
}

function formatAttachmentError(
  validation: Extract<ReturnType<typeof validateAttachmentFile>, { ok: false }>,
  t: Translations,
): string {
  switch (validation.code) {
    case "max_count":
      return t.chat.attachmentErrors.maxCount.replace(
        "{count}",
        String(validation.limit ?? ""),
      );
    case "max_total_size":
      return t.chat.attachmentErrors.maxTotalSize.replace(
        "{size}",
        formatAttachmentBytes(validation.limit ?? 0),
      );
    case "max_image_size":
      return t.chat.attachmentErrors.maxImageSize.replace(
        "{size}",
        formatAttachmentBytes(validation.limit ?? 0),
      );
    case "max_file_size":
      return t.chat.attachmentErrors.maxFileSize.replace(
        "{size}",
        formatAttachmentBytes(validation.limit ?? 0),
      );
    case "unsupported_type":
      return t.chat.attachmentErrors.unsupportedType.replace(
        "{name}",
        validation.name ?? "unknown",
      );
    default:
      return validation.reason;
  }
}

export function ChatInput({
  input,
  onChange,
  onSubmit,
  onStop,
  isGenerating,
  messages,
  attachments,
  onAttachmentsChange,
  onImportProject,
  hasExistingProject,
  onSlashCommand,
  forcedSkillIds,
  onForcedSkillIdsChange,
}: ChatInputProps) {
  const t = useT();
  const planModeEnabled = useSettingsStore((s) => s.system.planModeEnabled);
  const setPlanMode = useSettingsStore((s) => s.setPlanMode);
  const [isHoveringStop, setIsHoveringStop] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [skillsInitializing, setSkillsInitializing] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [projectImportOpen, setProjectImportOpen] = useState(false);
  const skillsAvailable = isSkillsAvailable();
  const skills = useSkillsStore((state) => state.skills);

  useEffect(() => {
    if (!skillsAvailable) return;
    let cancelled = false;
    setSkillsInitializing(true);
    getSkillRegistry()
      .catch(() => {
        // The management panel surfaces registry errors inline.
      })
      .finally(() => {
        if (!cancelled) setSkillsInitializing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [skillsAvailable]);

  const forcedSkills = useMemo(
    () =>
      forcedSkillIds
        .map((id) => skills[id])
        .filter((skill) => skill !== undefined),
    [forcedSkillIds, skills],
  );

  useEffect(() => {
    const validIds = forcedSkillIds.filter((id) => skills[id] !== undefined);
    if (validIds.length !== forcedSkillIds.length) {
      onForcedSkillIdsChange(validIds);
    }
  }, [forcedSkillIds, onForcedSkillIdsChange, skills]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const dragCounterRef = useRef(0);

  const slashMatch = /^\/(\S*)$/.exec(input);

  const hasMessages = messages.length > 0;
  const lastMsg = hasMessages ? messages[messages.length - 1] : null;
  const lastIsError =
    lastMsg?.role === "assistant" &&
    (lastMsg.isError ||
      // Backward-compat: legacy persisted error messages used a ⚠️ prefix.
      (typeof lastMsg.content === "string" &&
        lastMsg.content.startsWith("⚠️")));

  const filteredCmds = useMemo<SlashCommand[]>(() => {
    if (!slashMatch) return [];
    const q = slashMatch[1].toLowerCase();
    return SLASH_COMMANDS.filter((c) => {
      if (!c.startsWith(q)) return false;
      if (NEEDS_MESSAGES.has(c) && !hasMessages) return false;
      if (c === "retry") return lastIsError;
      if (c === "continue") return hasMessages && !lastIsError;
      return true;
    });
  }, [slashMatch?.[1], hasMessages, lastIsError]);
  const showSlashMenu = filteredCmds.length > 0 && !isGenerating;

  useEffect(() => {
    setSelectedIdx(0);
  }, [filteredCmds.length]);

  useEffect(() => {
    const menu = slashMenuRef.current;
    if (!menu) return;
    const item = menu.children[selectedIdx] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, []);

  useEffect(() => {
    if (!input && textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlashMenu) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => (i + 1) % filteredCmds.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx(
          (i) => (i - 1 + filteredCmds.length) % filteredCmds.length,
        );
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        onSlashCommand(filteredCmds[selectedIdx]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onChange("");
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const form = e.currentTarget.closest("form");
      if (form) form.requestSubmit();
    }
  };

  const processFiles = useCallback(
    async (files: File[]) => {
      let next = [...attachments];
      const accepted: Attachment[] = [];
      const errors: string[] = [];

      for (const file of files) {
        const validation = validateAttachmentFile(file, next);
        if (!validation.ok) {
          errors.push(formatAttachmentError(validation, t));
          continue;
        }
        try {
          const image = isImageMime(file.type);
          const attachment = await storeAttachmentFile(
            file,
            image ? "image" : "file",
          );
          accepted.push(attachment);
          next = [...next, attachment];
        } catch {
          errors.push(
            t.chat.attachmentErrors.readFailed.replace(
              "{name}",
              file.name || "file",
            ),
          );
        }
      }

      if (accepted.length > 0) {
        onAttachmentsChange([...attachments, ...accepted]);
      }
      setAttachmentError(errors[0] ?? null);
    },
    [attachments, onAttachmentsChange, t],
  );

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (isImageMime(item.type)) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          void processFiles([file]);
          return;
        }
      }
      const file = item.getAsFile();
      if (file && isAcceptedFileMime(item.type, file.name)) {
        e.preventDefault();
        void processFiles([file]);
        return;
      }
    }
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    void processFiles(Array.from(files));
    e.target.value = "";
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    void processFiles(Array.from(files));
    e.target.value = "";
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    void processFiles(Array.from(files));
  };

  const removeAttachment = (index: number) => {
    const removed = attachments[index];
    if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
    if (removed?.id) void deleteAttachment(removed.id);
    onAttachmentsChange(attachments.filter((_, i) => i !== index));
  };

  const hasContent = input.trim() || attachments.length > 0;

  return (
    <div
      className={`p-2 bg-background shrink-0 transition-colors ${isDragOver ? "ring-2 ring-primary/50 ring-inset rounded-lg bg-primary/5" : ""}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <form onSubmit={onSubmit}>
        {forcedSkills.length > 0 && (
          <div
            className="mb-2 flex flex-wrap items-center gap-1.5"
            aria-label={t.skills.forcedSelection}
          >
            <span className="mr-0.5 text-[11px] font-medium text-muted-foreground">
              {t.skills.forcedLabel}
            </span>
            {forcedSkills.map((skill) => (
              <button
                key={skill.id}
                type="button"
                className="inline-flex h-6 items-center gap-1 rounded-md border border-primary/20 bg-primary/10 px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={t.skills.removeForced.replace("{name}", skill.name)}
                onClick={() =>
                  onForcedSkillIdsChange(
                    forcedSkillIds.filter((id) => id !== skill.id),
                  )
                }
              >
                <span>{skill.name}</span>
                <X size={11} aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
        <AttachmentPreview
          attachments={attachments}
          onRemove={removeAttachment}
        />
        {attachmentError && (
          <p
            className="mb-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs text-destructive"
            aria-live="polite"
          >
            {attachmentError}
          </p>
        )}
        <div className="relative">
          {showSlashMenu && (
            <SlashCommandMenu
              ref={slashMenuRef}
              commands={filteredCmds}
              selectedIdx={selectedIdx}
              onSelect={(cmd) => onSlashCommand(cmd)}
              onHoverIdx={setSelectedIdx}
            />
          )}

          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleImageSelect}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept={FILE_ACCEPT}
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />

          <div className="border border-input rounded-lg bg-background focus-within:ring-1 focus-within:ring-ring overflow-hidden">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                onChange(e.target.value);
                autoResize();
              }}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={t.chat.placeholder}
              rows={2}
              disabled={isGenerating}
              className="border-0 shadow-none focus-visible:ring-0 focus-visible:border-0 resize-none overflow-y-auto bg-transparent px-3 py-2 md:text-base min-h-0 field-sizing-fixed"
              style={{ maxHeight: 200 }}
            />
            <ChatInputToolbar
              onPickImage={() => imageInputRef.current?.click()}
              onPickFile={() => fileInputRef.current?.click()}
              onUploadProject={() => setProjectImportOpen(true)}
              onManageSkills={
                skillsAvailable ? () => setSkillsOpen(true) : undefined
              }
              onManageMcp={() => setMcpOpen(true)}
              onReconnectMcp={async () => {
                const { getMcpConnectionManager } =
                  await import("../../lib/mcp/connection-manager");
                return getMcpConnectionManager().reconnectAll();
              }}
              skillsAvailable={skillsAvailable}
              skillsInitializing={skillsInitializing}
              forcedSkillIds={forcedSkillIds}
              onForcedSkillIdsChange={onForcedSkillIdsChange}
              planModeEnabled={planModeEnabled}
              setPlanMode={setPlanMode}
              isGenerating={isGenerating}
              hasContent={Boolean(hasContent)}
              isHoveringStop={isHoveringStop}
              onHoveringStopChange={setIsHoveringStop}
              onStop={onStop}
            />
          </div>
        </div>
      </form>
      {skillsAvailable && skillsOpen && (
        <Suspense fallback={null}>
          <SkillsPanel open onClose={() => setSkillsOpen(false)} />
        </Suspense>
      )}
      {mcpOpen && (
        <Suspense fallback={null}>
          <McpPanel
            open
            onClose={() => setMcpOpen(false)}
            onTestServer={async (id) => {
              const { getMcpConnectionManager } =
                await import("../../lib/mcp/connection-manager");
              await getMcpConnectionManager().testServer(id);
            }}
            onReconnectServer={async (id) => {
              const { getMcpConnectionManager } =
                await import("../../lib/mcp/connection-manager");
              await getMcpConnectionManager().reconnectServer(id);
            }}
            onAuthorizeServer={async (id) => {
              const { getMcpConnectionManager } =
                await import("../../lib/mcp/connection-manager");
              return getMcpConnectionManager().authorizeServer(id);
            }}
            onReviewServer={async (id) => {
              const { getMcpConnectionManager } =
                await import("../../lib/mcp/connection-manager");
              return getMcpConnectionManager().approveServer(id);
            }}
          />
        </Suspense>
      )}
      {projectImportOpen && (
        <Suspense fallback={null}>
          <ProjectImportDialog
            open
            hasExistingProject={hasExistingProject}
            isGenerating={isGenerating}
            onClose={() => setProjectImportOpen(false)}
            onImport={onImportProject}
          />
        </Suspense>
      )}
    </div>
  );
}
