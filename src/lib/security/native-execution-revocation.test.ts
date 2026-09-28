import { describe, expect, it } from "vitest";
import { nativeSkillScriptRevocation } from "./native-execution-revocation";

describe("native execution revocation", () => {
  it("invalidates in-flight work and blocks starts until every clear finishes", () => {
    const inFlight = nativeSkillScriptRevocation.capture();
    const first = nativeSkillScriptRevocation.begin();
    const second = nativeSkillScriptRevocation.begin();
    expect(nativeSkillScriptRevocation.isCurrent(inFlight)).toBe(false);
    expect(() => nativeSkillScriptRevocation.capture()).toThrow(/cancelled/i);

    nativeSkillScriptRevocation.finish(second);
    expect(() => nativeSkillScriptRevocation.capture()).toThrow(/cancelled/i);
    nativeSkillScriptRevocation.finish(first);
    expect(nativeSkillScriptRevocation.capture()).toBe(second);
  });
});
