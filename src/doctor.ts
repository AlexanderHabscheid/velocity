import fs from "node:fs";
import path from "node:path";
import { runCmd } from "./ops";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  optional?: boolean;
}

export interface DoctorSummary {
  ok: boolean;
  checks: CheckResult[];
}

export interface DoctorOptions {
  infra?: boolean;
}

function printCheck(check: CheckResult): void {
  const symbol = check.ok ? "PASS" : check.optional ? "WARN" : "FAIL";
  console.log(`${symbol} ${check.name}: ${check.detail}`);
}

export function runDoctor(options: DoctorOptions = {}): DoctorSummary {
  const checks: CheckResult[] = [];
  const infra = options.infra ?? false;

  const major = Number(process.versions.node.split(".")[0] ?? "0");
  checks.push({
    name: "node-runtime",
    ok: major >= 20,
    detail: `v${process.versions.node} (requires >=20)`,
  });

  const npmCli = runCmd("npm", ["--version"]);
  checks.push({
    name: "npm-cli",
    ok: npmCli.ok,
