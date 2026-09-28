import { describe, expect, it } from "vitest";
import {
  assertMcpLifecycleCurrent,
  beginMcpLifecycleRevocation,
  captureMcpLifecycleEpoch,
  finishMcpLifecycleRevocation,
  isMcpLifecycleCurrent,
} from "./revocation";

describe("MCP lifecycle revocation", () => {
  it("invalidates old leases and blocks new leases until clear finishes", () => {
    const lease = captureMcpLifecycleEpoch();
    const token = beginMcpLifecycleRevocation();

    expect(isMcpLifecycleCurrent(lease)).toBe(false);
    expect(() => captureMcpLifecycleEpoch()).toThrow(/revoked/i);
    expect(() => assertMcpLifecycleCurrent(lease)).toThrow(/revoked/i);

    finishMcpLifecycleRevocation(token);
    expect(captureMcpLifecycleEpoch()).toBe(token);
  });

  it("keeps the gate closed until overlapping clears both finish", () => {
    const first = beginMcpLifecycleRevocation();
    const second = beginMcpLifecycleRevocation();
    finishMcpLifecycleRevocation(second);
    expect(() => captureMcpLifecycleEpoch()).toThrow(/revoked/i);
    finishMcpLifecycleRevocation(first);
    expect(captureMcpLifecycleEpoch()).toBe(second);
  });
});
