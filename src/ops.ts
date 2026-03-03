import path from "node:path";
import { spawnSync } from "node:child_process";

export interface CmdResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

export function runCmd(cmd: string, args: string[], cwd = process.cwd(), stdin?: string): CmdResult {
  const out = spawnSync(cmd, args, {
    cwd,
    input: stdin,
    encoding: "utf8",
    stdio: stdin ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
  });
  return {
    ok: out.status === 0,
    code: out.status,
    stdout: out.stdout ?? "",
    stderr: out.stderr ?? "",
  };
}

export function runCmdStreaming(cmd: string, args: string[], cwd = process.cwd()): CmdResult {
  const out = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    stdio: "inherit",
  });
  return {
    ok: out.status === 0,
    code: out.status,
    stdout: "",
    stderr: "",
  };
}

export function resolveRepoPath(...parts: string[]): string {
  return path.resolve(process.cwd(), ...parts);
}
