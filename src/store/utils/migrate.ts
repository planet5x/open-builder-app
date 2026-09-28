/**
 * Shared migration helper for zustand persist `migrate` hooks.
 *
 * Each store keeps a numbered `steps` array. `steps[n]` upgrades a state
 * persisted at version `n` to version `n + 1`. The helper applies every step
 * required to bring the persisted state from its recorded version up to the
 * latest version.
 *
 * Stores stay on `version: 1` until they have a real shape change to roll
 * forward — the framework's value is that a future v2 can be added without
 * having to retrofit version handling first.
 */
export type MigrationStep<T = any> = (state: T) => T;

export function runMigrations<T = any>(
  steps: MigrationStep<T>[],
  persisted: T,
  from: number,
  to: number,
): T {
  let state = persisted;
  for (let v = from; v < to; v++) {
    const step = steps[v];
    if (step) {
      state = step(state);
    }
  }
  return state;
}
