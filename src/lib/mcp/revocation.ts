let lifecycleEpoch = 0;
const activeRevocations = new Set<number>();

export class McpLifecycleRevokedError extends Error {
  constructor() {
    super("MCP lifecycle was revoked by a full data clear.");
    this.name = "McpLifecycleRevokedError";
  }
}

export function beginMcpLifecycleRevocation(): number {
  lifecycleEpoch += 1;
  activeRevocations.add(lifecycleEpoch);
  return lifecycleEpoch;
}

export function finishMcpLifecycleRevocation(token: number): void {
  activeRevocations.delete(token);
}

export function captureMcpLifecycleEpoch(): number {
  if (activeRevocations.size > 0) throw new McpLifecycleRevokedError();
  return lifecycleEpoch;
}

export function isMcpLifecycleCurrent(epoch: number): boolean {
  return activeRevocations.size === 0 && lifecycleEpoch === epoch;
}

export function assertMcpLifecycleCurrent(epoch: number): void {
  if (!isMcpLifecycleCurrent(epoch)) throw new McpLifecycleRevokedError();
}
