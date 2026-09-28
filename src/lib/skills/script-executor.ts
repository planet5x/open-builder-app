export interface ScriptResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
}

export interface ScriptExecuteParams {
  skillId: string;
  skillName: string;
  skillSource: "builtin" | "imported";
  runId: string;
  callId: string;
  scriptPath: string;
  scriptContent: string;
  args: string[];
  signal?: AbortSignal;
}

export interface ScriptExecutor {
  canExecute(scriptPath: string): boolean;
  execute(params: ScriptExecuteParams): Promise<ScriptResult>;
}
