import { tool } from "ai";
import { z } from "zod";

export const SKILL_TOOL_NAMES = {
  LIST: "list_skills",
  READ: "read_skill",
  EXECUTE_SCRIPT: "execute_skill_script",
} as const;

export const SKILL_TOOL_NAME_SET: ReadonlySet<string> = new Set(
  Object.values(SKILL_TOOL_NAMES),
);

export const BASE_SKILL_TOOLS = {
  [SKILL_TOOL_NAMES.LIST]: tool({
    description:
      "List all currently enabled skills with their name and description. " +
      "Use this to refresh your view of available skills before deciding to call read_skill on one. " +
      "Skills are reusable domain-knowledge packs the user has installed.",
    inputSchema: z.object({}),
  }),

  [SKILL_TOOL_NAMES.READ]: tool({
    description:
      "Load the full guidance content of a named skill (its SKILL.md body) plus the list of " +
      "available reference files inside that skill. Call this when a skill is clearly relevant " +
      "to the user's current request. Follow the loaded guidance in your subsequent actions.",
    inputSchema: z.object({
      name: z
        .string()
        .describe("The skill name, as returned by list_skills."),
      reference_path: z
        .string()
        .optional()
        .describe(
          "Optional path relative to the skill's references/ directory. Use a path returned by read_skill.",
        ),
    }),
  }),
};

export const SCRIPT_SKILL_TOOL = {
  [SKILL_TOOL_NAMES.EXECUTE_SCRIPT]: tool({
    description:
      "Execute a script from a skill's scripts/ directory. " +
      "Only call this when the skill's SKILL.md explicitly instructs you to run a script for the current task. " +
      "Returns stdout, stderr, and exit code. Treat exit code 0 as success.",
    inputSchema: z.object({
      skill_name: z.string().describe("The skill name."),
      script_path: z
        .string()
        .describe(
          "Script filename relative to the skill's scripts/ directory, e.g. 'hello.js' or 'process.py'.",
        ),
      args: z
        .array(z.string())
        .optional()
        .describe("Optional command-line arguments passed to the script."),
    }),
  }),
};

export function getSkillTools(scriptExecutionEnabled: boolean) {
  return {
    ...BASE_SKILL_TOOLS,
    ...(scriptExecutionEnabled ? SCRIPT_SKILL_TOOL : {}),
  };
}
