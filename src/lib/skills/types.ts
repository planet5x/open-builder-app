export interface SkillEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  allowedTools?: string[];
  tags?: string[];
  autoEnabled: boolean;
  source: "builtin" | "imported";
  installedAt: number;
  cachedVersion?: string;
  availableVersion?: string;
}

export interface SkillManifestEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  allowedTools?: string[];
  tags?: string[];
  entry: string;
  files: string[];
}

export interface SkillManifest {
  schemaVersion: 1;
  skills: SkillManifestEntry[];
}

export interface PreparedSkill {
  entry: SkillEntry;
  content: string;
}
