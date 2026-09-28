import { asSchema } from "ai";
import type { ToolSet } from "ai";
import type { LocalToolSpec } from "./types";

export async function serializeLocalToolSet(
  tools: ToolSet,
  omittedNames: ReadonlySet<string> = new Set(),
): Promise<LocalToolSpec[]> {
  return Promise.all(
    Object.entries(tools)
      .filter(([name]) => !omittedNames.has(name))
      .map(async ([name, definition]) => ({
        name,
        description:
          typeof definition.description === "string"
            ? definition.description
            : "Open Builder host tool",
        inputSchema: (await asSchema(definition.inputSchema)
          .jsonSchema) as Record<string, unknown>,
      })),
  );
}

export async function validateLocalToolArguments(
  tools: ToolSet,
  name: string,
  value: unknown,
): Promise<
  { success: true; value: unknown } | { success: false; error: Error }
> {
  const definition = tools[name];
  if (!definition) {
    return {
      success: false,
      error: new Error(`Tool "${name}" is not authorized for this run.`),
    };
  }
  const schema = asSchema(definition.inputSchema);
  if (!schema.validate) {
    return {
      success: false,
      error: new Error(`Tool "${name}" has no enforceable input validator.`),
    };
  }
  return schema.validate(value);
}
