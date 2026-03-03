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
    detail: npmCli.ok ? npmCli.stdout.trim() : npmCli.stderr.trim() || "npm unavailable",
  });

  const stateDir = path.resolve(process.cwd(), ".velocity");
  let writable = false;
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    const probe = path.join(stateDir, ".doctor-write-probe");
    fs.writeFileSync(probe, "ok\n", "utf8");
    fs.unlinkSync(probe);
    writable = true;
  } catch {
    writable = false;
  }
  checks.push({
    name: "state-dir",
    ok: writable,
    detail: writable ? `${stateDir} writable` : `${stateDir} is not writable`,
  });

  checks.push({
    name: "listener-engine-uws",
    ok: runCmd("node", ["-e", "import('uWebSockets.js').then(()=>process.exit(0)).catch(()=>process.exit(1))"]).ok,
    detail: "optional (ws engine works without it)",
    optional: true,
  });

  if (infra) {
    const dockerDaemon = runCmd("docker", ["info"]);
    checks.push({
      name: "docker-daemon",
      ok: dockerDaemon.ok,
      detail: dockerDaemon.ok ? "reachable" : dockerDaemon.stderr.trim() || "daemon unavailable",
    });

    const kubectlCli = runCmd("kubectl", ["version", "--client=true", "--output=yaml"]);
    checks.push({
      name: "kubectl-cli",
      ok: kubectlCli.ok,
      detail: kubectlCli.ok ? "installed" : kubectlCli.stderr.trim() || "kubectl unavailable",
    });

    const kubectlContext = runCmd("kubectl", ["config", "current-context"]);
    checks.push({
      name: "kubectl-context",
      ok: kubectlContext.ok,
      detail: kubectlContext.ok ? kubectlContext.stdout.trim() : kubectlContext.stderr.trim() || "no current context",
    });
  }

  for (const check of checks) {
    printCheck(check);
  }

  return {
    ok: checks.every((c) => c.ok || c.optional),
    checks,
  };
}
