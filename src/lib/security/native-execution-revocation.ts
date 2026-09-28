interface NativeExecutionRevocationGate {
  begin(): number;
  finish(token: number): void;
  capture(): number;
  isCurrent(epoch: number): boolean;
}

function createGate(label: string): NativeExecutionRevocationGate {
  let epoch = 0;
  const activeRevocations = new Set<number>();
  return {
    begin() {
      epoch += 1;
      activeRevocations.add(epoch);
      return epoch;
    },
    finish(token) {
      activeRevocations.delete(token);
    },
    capture() {
      if (activeRevocations.size > 0) {
        throw new DOMException(`${label} was cancelled.`, "AbortError");
      }
      return epoch;
    },
    isCurrent(candidate) {
      return activeRevocations.size === 0 && candidate === epoch;
    },
  };
}

export const nativeSkillScriptRevocation = createGate(
  "Native Skill script execution",
);
export const nativeSseRevocation = createGate("Native AI stream execution");
