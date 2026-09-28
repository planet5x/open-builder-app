import type { Conversation, ProjectFiles, ProjectTemplate } from "../../types";

export interface TemplateMetadataInput {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  now: number;
}

export interface TemplateStats {
  fileCount: number;
  totalBytes: number;
}

const MAX_TAGS = 8;
export const PROJECT_TEMPLATE_LIMITS = {
  maxFiles: 300,
  maxTotalBytes: 5 * 1024 * 1024,
  maxFileBytes: 2 * 1024 * 1024,
} as const;

export function createProjectTemplateFromConversation(
  conversation: Conversation,
  input: TemplateMetadataInput,
): ProjectTemplate {
  const files = cloneProjectFiles(conversation.files);
  const validation = validateProjectTemplateFiles(files);
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  if (Object.keys(files).length === 0) {
    throw new Error("Cannot create a template from an empty project.");
  }

  return {
    id: input.id,
    name: sanitizeTemplateName(input.name),
    description: normalizeOptionalText(input.description),
    files,
    template: conversation.template,
    previewMode: conversation.previewMode ?? "sandpack",
    sourceConversationId: conversation.id,
    tags: normalizeTemplateTags(input.tags ?? []),
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function createConversationFromProjectTemplate(
  template: ProjectTemplate,
  input: { id: string; now: number },
): Conversation {
  return {
    id: input.id,
    title: template.name,
    messages: [],
    files: cloneProjectFiles(template.files),
    template: template.template,
    previewMode: template.previewMode ?? "sandpack",
    isProjectInitialized: Object.keys(template.files).length > 0,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function getProjectTemplateStats(
  template: Pick<ProjectTemplate, "files">,
): TemplateStats {
  const files = Object.values(template.files);
  return {
    fileCount: files.length,
    totalBytes: files.reduce(
      (total, content) => total + byteLength(content),
      0,
    ),
  };
}

export function validateProjectTemplateFiles(
  files: ProjectFiles,
): { ok: true } | { ok: false; error: string } {
  const entries = Object.entries(files);
  if (entries.length > PROJECT_TEMPLATE_LIMITS.maxFiles) {
    return {
      ok: false,
      error: `Project template has too many files (max ${PROJECT_TEMPLATE_LIMITS.maxFiles}).`,
    };
  }

  let totalBytes = 0;
  for (const [path, content] of entries) {
    const size = byteLength(content);
    if (size > PROJECT_TEMPLATE_LIMITS.maxFileBytes) {
      return {
        ok: false,
        error: `Project template file "${path}" is too large (max ${PROJECT_TEMPLATE_LIMITS.maxFileBytes} bytes).`,
      };
    }
    totalBytes += size;
    if (totalBytes > PROJECT_TEMPLATE_LIMITS.maxTotalBytes) {
      return {
        ok: false,
        error: `Project template is too large (max ${PROJECT_TEMPLATE_LIMITS.maxTotalBytes} bytes).`,
      };
    }
  }
  return { ok: true };
}

export function normalizeTemplateTags(tags: string[]): string[] {
  const normalized = tags
    .map((tag) => tag.trim().replace(/\s+/g, " "))
    .filter(Boolean);

  return Array.from(new Set(normalized)).slice(0, MAX_TAGS);
}

export function sanitizeTemplateName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  return trimmed || "Untitled Template";
}

export function cloneProjectFiles(files: ProjectFiles): ProjectFiles {
  return { ...files };
}

function normalizeOptionalText(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}
