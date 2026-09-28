import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import localforage from "localforage";
import type { ProjectTemplate } from "../types";
import { createLocalforageStorage } from "./utils/localforage-storage";
import { runMigrations, type MigrationStep } from "./utils/migrate";
import {
  normalizeTemplateTags,
  sanitizeTemplateName,
  validateProjectTemplateFiles,
} from "../lib/utils/project-templates";

const PROJECT_TEMPLATE_STORE_VERSION = 1;
const projectTemplateMigrations: MigrationStep[] = [];

const projectTemplateStorage = createLocalforageStorage(
  localforage.createInstance({ name: "open-builder-project-templates" }),
);

type TemplateMetadataUpdate = Partial<
  Pick<ProjectTemplate, "name" | "description" | "tags">
>;

interface ProjectTemplateState {
  templates: Record<string, ProjectTemplate>;
  _hasHydrated: boolean;

  addTemplate: (template: ProjectTemplate) => string;
  updateTemplate: (id: string, patch: TemplateMetadataUpdate) => boolean;
  deleteTemplate: (id: string) => boolean;
  getTemplate: (id: string) => ProjectTemplate | undefined;
  listTemplates: () => ProjectTemplate[];
}

export const useProjectTemplateStore = create<ProjectTemplateState>()(
  persist(
    (set, get) => ({
      templates: {},
      _hasHydrated: false,

      addTemplate: (template) => {
        const validation = validateProjectTemplateFiles(template.files);
        if (!validation.ok) {
          throw new Error(validation.error);
        }
        set((s) => ({
          templates: { ...s.templates, [template.id]: template },
        }));
        return template.id;
      },

      updateTemplate: (id, patch) => {
        const existing = get().templates[id];
        if (!existing) return false;
        const next: ProjectTemplate = {
          ...existing,
          ...patch,
          name:
            patch.name === undefined
              ? existing.name
              : sanitizeTemplateName(patch.name),
          description:
            patch.description === undefined
              ? existing.description
              : patch.description.trim() || undefined,
          tags:
            patch.tags === undefined
              ? existing.tags
              : normalizeTemplateTags(patch.tags),
          updatedAt: Date.now(),
        };
        set((s) => ({
          templates: { ...s.templates, [id]: next },
        }));
        return true;
      },

      deleteTemplate: (id) => {
        if (!get().templates[id]) return false;
        set((s) => {
          const { [id]: _deleted, ...rest } = s.templates;
          return { templates: rest };
        });
        return true;
      },

      getTemplate: (id) => get().templates[id],
      listTemplates: () =>
        Object.values(get().templates).sort((a, b) => b.updatedAt - a.updatedAt),
    }),
    {
      name: "open-builder-project-templates",
      version: PROJECT_TEMPLATE_STORE_VERSION,
      storage: createJSONStorage(() => projectTemplateStorage),
      partialize: (state) => ({
        templates: state.templates,
      }),
      migrate: (persisted, version) =>
        runMigrations(
          projectTemplateMigrations,
          persisted,
          version,
          PROJECT_TEMPLATE_STORE_VERSION,
        ),
      onRehydrateStorage: () => () => {
        useProjectTemplateStore.setState({ _hasHydrated: true });
      },
    },
  ),
);
