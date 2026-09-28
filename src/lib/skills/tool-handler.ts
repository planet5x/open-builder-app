import type { SkillRegistry } from "./registry";
import type { SkillEntry } from "./types";
import type { ScriptExecutor } from "./script-executor";
import {
  normalizeScriptResult,
  validateScriptExecuteParams,
} from "./script-execution-guard";
import { SKILL_TOOL_NAMES } from "./tools";
import type { PreparedSkill } from "./types";
import type { ToolExecutionContext } from "../ai/generator-types";
import type { SkillActiveContextController } from "./active-context";

export interface SkillToolDeps {
  getRegistry: () => Promise<SkillRegistry>;
  getExecutor: () => Promise<ScriptExecutor>;
  scriptExecutionEnabled?: boolean;
  /** Test/standalone fallback. Production passes the run-local context. */
  skillContext?: SkillActiveContextController;
}

function findByName(
  registry: SkillRegistry,
  name: string,
  includeAutoDisabled = false,
): SkillEntry | undefined {
  const enabled = includeAutoDisabled
    ? registry.list()
    : registry.getAutoEnabled();
  return (
    enabled.find((s) => s.name === name) ?? enabled.find((s) => s.id === name)
  );
}

function parseScriptArgs(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error("'args' must be an array of strings.");
  }
  if (!value.every((arg) => typeof arg === "string")) {
    throw new Error("'args' must be an array of strings.");
  }
  return value;
}

export function createSkillToolHandler(
  deps: SkillToolDeps,
): (
  name: string,
  args: unknown,
  context?: ToolExecutionContext,
) => Promise<string> {
  return async (name, args, context) => {
    const activeContext = context?.skillContext ?? deps.skillContext;
    if (name === SKILL_TOOL_NAMES.LIST) {
      const registry = await deps.getRegistry();
      const skills = registry.getAutoEnabled();
      if (skills.length === 0) {
        return "No skills are currently enabled.";
      }
      const lines = skills.map(
        (s) =>
          `- ${s.name}: ${s.description}` +
          (s.allowedTools && s.allowedTools.length > 0
            ? ` (allowed-tools: ${s.allowedTools.join(", ")})`
            : ""),
      );
      return `Enabled skills (${skills.length}):\n${lines.join("\n")}`;
    }

    if (name === SKILL_TOOL_NAMES.READ) {
      const { name: skillName, reference_path: referencePath } = args as {
        name: string;
        reference_path?: string;
      };
      if (!skillName) return "Error: 'name' is required.";
      const registry = await deps.getRegistry();
      const autoMatched = findByName(registry, skillName);
      const forced = autoMatched
        ? undefined
        : findByName(registry, skillName, true);
      const skill =
        autoMatched ??
        (forced && activeContext?.isActive(forced.id) ? forced : undefined);
      if (!skill) {
        return `Error: skill "${skillName}" not found or not enabled.`;
      }
      if (referencePath) {
        try {
          const reference = await registry.readReference(
            skill.id,
            referencePath,
          );
          activeContext?.activate(skill);
          return `# Skill reference: ${skill.name}/${referencePath}\n\n${reference}`;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return `Error: cannot read reference "${referencePath}" in skill "${skillName}": ${msg}`;
        }
      }
      const body = await registry.readSkillContent(skill.id);
      const references = await registry.listReferences(skill.id);
      const scripts = await registry.listScripts(skill.id);
      const sections: string[] = [];
      sections.push(`# Skill: ${skill.name}`);
      sections.push(body.trim());
      if (references.length > 0) {
        sections.push(
          `\n## References available\n${references.map((r) => `- ${r} (call read_skill with reference_path="${r}" to load it)`).join("\n")}`,
        );
      }
      if (scripts.length > 0) {
        sections.push(
          `\n## Scripts available\n${scripts.map((s) => `- ${s} - invoke via execute_skill_script with skill_name="${skill.name}" and script_path="${s}"`).join("\n")}`,
        );
      }
      if (skill.allowedTools && skill.allowedTools.length > 0) {
        sections.push(
          `\n## Tool restriction\nThis skill declares allowed-tools: ${skill.allowedTools.join(", ")}. ` +
            `Until the next user message, only these tools (plus flow tools like ask_user_question / exit_plan_mode / list_skills / read_skill / execute_skill_script / dispatch_subagent / compact_context) are available.`,
        );
      }
      activeContext?.activate(skill);
      return sections.join("\n");
    }

    if (name === SKILL_TOOL_NAMES.EXECUTE_SCRIPT) {
      if (!deps.scriptExecutionEnabled) {
        return "Error: skill script execution is only available in the desktop app.";
      }
      const {
        skill_name: skillName,
        script_path: scriptPath,
        args: rawScriptArgs,
      } = args as { skill_name: string; script_path: string; args?: unknown };
      if (!skillName || !scriptPath) {
        return "Error: 'skill_name' and 'script_path' are required.";
      }
      let scriptArgs: string[];
      try {
        scriptArgs = parseScriptArgs(rawScriptArgs);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Error: ${msg}`;
      }
      const registry = await deps.getRegistry();
      const skill = findByName(registry, skillName, true);
      if (!skill) {
        return `Error: skill "${skillName}" not found.`;
      }
      if (!activeContext?.isActive(skill.id)) {
        return `Error: skill "${skillName}" must be loaded with read_skill or explicitly forced before running its scripts.`;
      }
      let scriptContent: string;
      try {
        scriptContent = await registry.readScript(skill.id, scriptPath);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Error: cannot read script "${scriptPath}" in skill "${skillName}": ${msg}`;
      }
      const executor = await deps.getExecutor();
      if (!executor.canExecute(scriptPath)) {
        return `Error: no executor available for script "${scriptPath}" in this environment.`;
      }
      try {
        const executionParams = {
          skillId: skill.id,
          skillName: skill.name,
          skillSource: skill.source,
          runId: context?.run.runId ?? "standalone",
          callId: context?.toolCallId ?? "standalone",
          scriptPath,
          scriptContent,
          args: scriptArgs,
          signal: context?.signal,
        };
        validateScriptExecuteParams(executionParams);
        const result = normalizeScriptResult(
          await executor.execute(executionParams),
        );
        const parts: string[] = [];
        parts.push(`Exit code: ${result.exitCode}`);
        if (result.stdout) parts.push(`stdout:\n${result.stdout}`);
        if (result.stdoutTruncated) {
          parts.push("[stdout truncated]");
        }
        if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
        if (result.stderrTruncated) {
          parts.push("[stderr truncated]");
        }
        return parts.join("\n\n");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Error: script execution failed: ${msg}`;
      }
    }

    return `Error: unknown skill tool "${name}"`;
  };
}

export function buildSkillsPromptSection(enabled: SkillEntry[]): string {
  if (enabled.length === 0) return "";
  const lines = enabled.map((s) => {
    const metadata = [
      `id: ${s.id}`,
      `version: ${s.version}`,
      ...(s.tags && s.tags.length > 0 ? [`tags: ${s.tags.join(", ")}`] : []),
      ...(s.allowedTools && s.allowedTools.length > 0
        ? [`allowed-tools: ${s.allowedTools.join(", ")}`]
        : []),
    ];
    return `- **${s.name}** (${metadata.join("; ")}): ${s.description}`;
  });
  return `\n\n<skills>
## Auto-discoverable skill metadata
The entries below are metadata only; no skill instructions are present in this section. Match them against the request, then call \`read_skill\` for every clear match before planning or acting. The tool returns the full instructions plus reference and script listings, and activates any declared allowed-tools restriction. A request may need more than one skill. Call \`list_skills\` for a fresh metadata listing.

${lines.join("\n")}
</skills>`;
}

export function buildForcedSkillsPromptSection(
  prepared: readonly PreparedSkill[],
): string {
  if (prepared.length === 0) return "";
  const blocks = prepared.map(
    ({ entry, content }) =>
      `<skill id="${entry.id}" name="${entry.name}">\n${content.trim()}\n</skill>`,
  );
  return `\n\n<mandatory_skills>
The user selected these skills for this request, so their full instructions are already loaded. Treat every selected skill as mandatory for the whole request and every subagent you dispatch. Apply all compatible instructions. When two selected skills conflict in a way that changes the result, call ask_user_question instead of choosing silently. Platform, tool, and mode safety rules and the user's explicit request still outrank them.

${blocks.join("\n\n")}
</mandatory_skills>`;
}
