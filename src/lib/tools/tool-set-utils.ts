import type { ToolSet } from "ai";

export function filterToolSet(
  set: ToolSet,
  predicate: (name: string) => boolean,
): ToolSet {
  return Object.fromEntries(
    Object.entries(set).filter(([name]) => predicate(name)),
  );
}
