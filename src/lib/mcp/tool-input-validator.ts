import type Ajv from "ajv";
import type { ErrorObject, ValidateFunction } from "ajv";
import type { JsonObject } from "./types";

export type McpToolInputValidationResult =
  { success: true; value: unknown } | { success: false; error: Error };

let ajvPromise: Promise<Ajv> | undefined;

function loadAjv(): Promise<Ajv> {
  if (!ajvPromise) {
    ajvPromise = import("ajv").then(
      ({ default: Ajv }) =>
        new Ajv({
          allErrors: true,
          coerceTypes: false,
          removeAdditional: false,
          strict: true,
          useDefaults: false,
          validateSchema: true,
        }),
    );
  }
  return ajvPromise;
}

const validatorCache = new WeakMap<object, ValidateFunction>();
const MAX_SCHEMA_BYTES = 256 * 1024;
const MAX_SCHEMA_NODES = 4_096;
const MAX_SCHEMA_DEPTH = 48;
const MAX_TOOL_INPUT_BYTES = 4 * 1024 * 1024;

const SINGLE_SCHEMA_KEYWORDS = [
  "additionalItems",
  "additionalProperties",
  "contains",
  "contentSchema",
  "else",
  "if",
  "items",
  "not",
  "propertyNames",
  "then",
  "unevaluatedItems",
  "unevaluatedProperties",
] as const;
const SCHEMA_ARRAY_KEYWORDS = [
  "allOf",
  "anyOf",
  "oneOf",
  "prefixItems",
] as const;
const SCHEMA_MAP_KEYWORDS = [
  "$defs",
  "definitions",
  "dependentSchemas",
  "dependencies",
  "properties",
] as const;

function validationMessage(errors: ErrorObject[] | null | undefined): string {
  if (!errors?.length) return "arguments do not match the approved schema";
  return errors
    .slice(0, 4)
    .map((issue) => {
      const path = issue.instancePath || "/";
      return `${path} ${issue.message ?? "is invalid"}`;
    })
    .join("; ");
}

function jsonByteLength(value: unknown, label: string): number {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw new Error(`${label} is not JSON-serializable`, { cause: error });
  }
  return serialized === undefined
    ? 0
    : new TextEncoder().encode(serialized).byteLength;
}

function assertSafeSchema(schema: JsonObject): void {
  if (jsonByteLength(schema, "JSON Schema") > MAX_SCHEMA_BYTES) {
    throw new Error(`JSON Schema exceeds ${MAX_SCHEMA_BYTES} bytes`);
  }

  let nodes = 0;
  const visit = (candidate: unknown, depth: number): void => {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      return;
    }
    if (depth > MAX_SCHEMA_DEPTH) {
      throw new Error(`JSON Schema exceeds depth ${MAX_SCHEMA_DEPTH}`);
    }
    nodes += 1;
    if (nodes > MAX_SCHEMA_NODES) {
      throw new Error(`JSON Schema exceeds ${MAX_SCHEMA_NODES} nodes`);
    }

    const node = candidate as Record<string, unknown>;
    if (
      typeof node.pattern === "string" ||
      node.patternProperties !== undefined
    ) {
      throw new Error(
        "regular-expression JSON Schema keywords are not supported in the renderer",
      );
    }

    for (const keyword of SINGLE_SCHEMA_KEYWORDS) {
      const child = node[keyword];
      if (Array.isArray(child)) {
        for (const entry of child) visit(entry, depth + 1);
      } else {
        visit(child, depth + 1);
      }
    }
    for (const keyword of SCHEMA_ARRAY_KEYWORDS) {
      const children = node[keyword];
      if (Array.isArray(children)) {
        for (const child of children) visit(child, depth + 1);
      }
    }
    for (const keyword of SCHEMA_MAP_KEYWORDS) {
      const children = node[keyword];
      if (
        !children ||
        typeof children !== "object" ||
        Array.isArray(children)
      ) {
        continue;
      }
      for (const child of Object.values(children)) visit(child, depth + 1);
    }
  };

  visit(schema, 0);
}

function validateInputSize(
  value: unknown,
): McpToolInputValidationResult | null {
  try {
    const bytes = jsonByteLength(value, "tool input");
    return bytes > MAX_TOOL_INPUT_BYTES
      ? {
          success: false,
          error: new Error(`tool input exceeds ${MAX_TOOL_INPUT_BYTES} bytes`),
        }
      : null;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

export async function compileMcpToolInputValidator(
  schema: JsonObject,
): Promise<(value: unknown) => McpToolInputValidationResult> {
  if (schema.$async === true) {
    throw new Error("asynchronous JSON Schemas are not supported");
  }
  assertSafeSchema(schema);

  let validator = validatorCache.get(schema);
  if (!validator) {
    const ajv = await loadAjv();
    if (!ajv.validateSchema(schema)) {
      throw new Error(`invalid JSON Schema: ${validationMessage(ajv.errors)}`);
    }
    try {
      validator = ajv.compile(schema);
    } catch (error) {
      throw new Error(
        `unsupported JSON Schema: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }
    validatorCache.set(schema, validator);
  }

  return (value) => {
    const sizeError = validateInputSize(value);
    if (sizeError) return sizeError;
    const valid = validator!(value);
    if (valid === true) return { success: true, value };
    return {
      success: false,
      error: new Error(validationMessage(validator!.errors)),
    };
  };
}

export async function validateMcpToolInput(
  schema: JsonObject,
  value: unknown,
): Promise<McpToolInputValidationResult> {
  try {
    return (await compileMcpToolInputValidator(schema))(value);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
