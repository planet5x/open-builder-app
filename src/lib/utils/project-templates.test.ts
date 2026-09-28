import { describe, expect, it } from "vitest";
import type { Conversation, ProjectTemplate } from "../../types";
import {
  PROJECT_TEMPLATE_LIMITS,
  createConversationFromProjectTemplate,
  createProjectTemplateFromConversation,
  getProjectTemplateStats,
  normalizeTemplateTags,
  sanitizeTemplateName,
  validateProjectTemplateFiles,
} from "./project-templates";

const conversation: Conversation = {
  id: "conv-1",
  title: "Portfolio",
  messages: [{ role: "user", content: "Build a portfolio" }],
  files: {
    "src/App.tsx": "export function App() { return <main />; }",
    "README.md": "你好",
  },
  template: "vite-react-ts",
  isProjectInitialized: true,
  createdAt: 1,
  updatedAt: 2,
};

describe("project template utilities", () => {
  it("creates a reusable project template from a conversation", () => {
    const template = createProjectTemplateFromConversation(conversation, {
      id: "template-1",
      name: "  Portfolio   Starter  ",
      description: "  Personal site  ",
      tags: [" react ", "react", "landing page"],
      now: 10,
    });

    expect(template).toMatchObject({
      id: "template-1",
      name: "Portfolio Starter",
      description: "Personal site",
      template: "vite-react-ts",
      sourceConversationId: "conv-1",
      tags: ["react", "landing page"],
      createdAt: 10,
      updatedAt: 10,
    });
    expect(template.files).toEqual(conversation.files);
    expect(template.files).not.toBe(conversation.files);
  });

  it("rejects empty project templates", () => {
    expect(() =>
      createProjectTemplateFromConversation(
        { ...conversation, files: {}, isProjectInitialized: false },
        { id: "template-1", name: "Empty", now: 10 },
      ),
    ).toThrow("Cannot create a template from an empty project.");
  });

  it("rejects project templates that exceed storage budgets", () => {
    expect(
      validateProjectTemplateFiles({
        "src/large.ts": "x".repeat(PROJECT_TEMPLATE_LIMITS.maxFileBytes + 1),
      }),
    ).toEqual({
      ok: false,
      error: `Project template file "src/large.ts" is too large (max ${PROJECT_TEMPLATE_LIMITS.maxFileBytes} bytes).`,
    });

    expect(() =>
      createProjectTemplateFromConversation(
        {
          ...conversation,
          files: {
            "src/large.ts": "x".repeat(
              PROJECT_TEMPLATE_LIMITS.maxFileBytes + 1,
            ),
          },
        },
        { id: "template-1", name: "Large", now: 10 },
      ),
    ).toThrow("too large");
  });

  it("creates a new initialized conversation from a template", () => {
    const template: ProjectTemplate = {
      id: "template-1",
      name: "Dashboard",
      files: { "src/App.tsx": "dashboard" },
      template: "vite-react-ts",
      tags: [],
      createdAt: 1,
      updatedAt: 2,
    };

    const next = createConversationFromProjectTemplate(template, {
      id: "conv-2",
      now: 20,
    });

    expect(next).toMatchObject({
      id: "conv-2",
      title: "Dashboard",
      messages: [],
      template: "vite-react-ts",
      isProjectInitialized: true,
      createdAt: 20,
      updatedAt: 20,
    });
    expect(next.files).toEqual(template.files);
    expect(next.files).not.toBe(template.files);
  });

  it("normalizes labels and reports template stats", () => {
    expect(sanitizeTemplateName("   ")).toBe("Untitled Template");
    expect(normalizeTemplateTags([" admin ", "admin", "", "crm  tool"])).toEqual([
      "admin",
      "crm tool",
    ]);
    expect(getProjectTemplateStats({ files: conversation.files })).toEqual({
      fileCount: 2,
      totalBytes: 48,
    });
  });
});
