export const SKILLS_STORE_VERSION = 2;

export function migrateSkillsState(state: unknown): unknown {
  const value = state as Record<string, any>;
  const entries = value.skills as
    | Record<string, Record<string, any>>
    | undefined;
  if (entries) {
    for (const entry of Object.values(entries)) {
      if (entry.autoEnabled === undefined) {
        entry.autoEnabled = entry.enabled ?? true;
      }
      if (
        entry.cachedVersion === undefined &&
        entry.builtinVersion !== undefined
      ) {
        entry.cachedVersion = entry.builtinVersion;
      }
      delete entry.enabled;
      delete entry.builtinVersion;
    }
  }
  delete value.scriptWarningAcknowledged;
  return value;
}
