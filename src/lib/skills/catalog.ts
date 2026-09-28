import type { SkillEntry } from "./types";

export type SkillCatalogFilter =
  | "all"
  | "auto"
  | "builtin"
  | "imported"
  | "scripts";

export type SkillCatalogSort = "recommended" | "updated" | "permissions";

export type SkillRisk = "low" | "medium" | "high";

export interface SkillCatalogDetails {
  references: string[];
  scripts: string[];
}

export type SkillCatalogDetailsMap = Record<string, SkillCatalogDetails>;

export interface SkillCatalogItem {
  skill: SkillEntry;
  permissionCount: number;
  referenceCount: number;
  scriptCount: number;
  risk: SkillRisk;
}

export interface SkillCatalogSummary {
  total: number;
  autoEnabled: number;
  builtin: number;
  imported: number;
  withScripts: number;
}

export interface SkillCatalogOptions {
  query?: string;
  filter?: SkillCatalogFilter;
  sort?: SkillCatalogSort;
}

export function buildSkillCatalogItems(
  skills: SkillEntry[],
  details: SkillCatalogDetailsMap = {},
): SkillCatalogItem[] {
  return skills.map((skill) => {
    const skillDetails = details[skill.id];
    const permissionCount = skill.allowedTools?.length ?? 0;
    const scriptCount = skillDetails?.scripts.length ?? 0;
    const referenceCount = skillDetails?.references.length ?? 0;
    return {
      skill,
      permissionCount,
      referenceCount,
      scriptCount,
      risk: getSkillRisk(skill, scriptCount, permissionCount),
    };
  });
}

export function filterAndSortSkillCatalog(
  skills: SkillEntry[],
  details: SkillCatalogDetailsMap,
  options: SkillCatalogOptions = {},
): SkillCatalogItem[] {
  const query = options.query?.trim().toLowerCase() ?? "";
  const filter = options.filter ?? "all";
  const sort = options.sort ?? "recommended";

  return buildSkillCatalogItems(skills, details)
    .filter((item) => matchesFilter(item, filter))
    .filter((item) => matchesQuery(item.skill, query))
    .sort((a, b) => compareCatalogItems(a, b, sort));
}

export function summarizeSkillCatalog(
  skills: SkillEntry[],
  details: SkillCatalogDetailsMap,
): SkillCatalogSummary {
  const items = buildSkillCatalogItems(skills, details);
  return {
    total: items.length,
    autoEnabled: items.filter((item) => item.skill.autoEnabled).length,
    builtin: items.filter((item) => item.skill.source === "builtin").length,
    imported: items.filter((item) => item.skill.source === "imported").length,
    withScripts: items.filter((item) => item.scriptCount > 0).length,
  };
}

function getSkillRisk(
  skill: SkillEntry,
  scriptCount: number,
  permissionCount: number,
): SkillRisk {
  const hasScriptExecutor = skill.allowedTools?.includes("execute_skill_script");
  if (scriptCount > 0 || hasScriptExecutor) return "high";
  if (skill.source === "imported" || permissionCount >= 4) return "medium";
  return "low";
}

function matchesFilter(item: SkillCatalogItem, filter: SkillCatalogFilter) {
  switch (filter) {
    case "auto":
      return item.skill.autoEnabled;
    case "builtin":
      return item.skill.source === "builtin";
    case "imported":
      return item.skill.source === "imported";
    case "scripts":
      return item.scriptCount > 0;
    case "all":
    default:
      return true;
  }
}

function matchesQuery(skill: SkillEntry, query: string) {
  if (!query) return true;
  const haystack = [
    skill.id,
    skill.name,
    skill.description,
    skill.version,
    skill.source,
    ...(skill.tags ?? []),
    ...(skill.allowedTools ?? []),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function compareCatalogItems(
  a: SkillCatalogItem,
  b: SkillCatalogItem,
  sort: SkillCatalogSort,
) {
  if (sort === "updated") {
    return b.skill.installedAt - a.skill.installedAt || compareByName(a, b);
  }
  if (sort === "permissions") {
    return (
      b.permissionCount - a.permissionCount ||
      b.scriptCount - a.scriptCount ||
      compareByName(a, b)
    );
  }

  const source = sourceWeight(a.skill) - sourceWeight(b.skill);
  if (source !== 0) return source;
  const risk = riskWeight(a.risk) - riskWeight(b.risk);
  if (risk !== 0) return risk;
  return compareByName(a, b);
}

function compareByName(a: SkillCatalogItem, b: SkillCatalogItem) {
  return a.skill.name.localeCompare(b.skill.name);
}

function sourceWeight(skill: SkillEntry) {
  return skill.source === "builtin" ? 0 : 1;
}

function riskWeight(risk: SkillRisk) {
  switch (risk) {
    case "low":
      return 0;
    case "medium":
      return 1;
    case "high":
      return 2;
  }
}
