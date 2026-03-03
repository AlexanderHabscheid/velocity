import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function run(cmd, args, cwd, env = process.env) {
  const result = spawnSync(cmd, args, {
    cwd,
    env,
    stdio: "pipe",
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const out = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${cmd} ${args.join(" ")} failed${out ? `\n${out}` : ""}`);
  }
  return result.stdout.trim();
}

function main() {
  const root = process.cwd();
  const pkgJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const packageName = String(pkgJson.name);
  const expectedVersion = String(pkgJson.version);
  const tarballPrefix = packageName.replace(/^@/, "").replace(/\//g, "-");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "velocity-package-smoke-"));
  const installDir = path.join(temp, "install");
  fs.mkdirSync(installDir, { recursive: true });

  try {
    run("npm", ["pack", "--pack-destination", temp], root);
    const tgz = fs.readdirSync(temp).find((name) => name.startsWith(`${tarballPrefix}-`) && name.endsWith(".tgz"));
    if (!tgz) {
      throw new Error(`npm pack did not produce expected tarball prefix: ${tarballPrefix}`);
    }
    const tarballPath = path.join(temp, tgz);
    run("npm", ["init", "-y"], installDir);
    run("npm", ["install", tarballPath], installDir);
    const version = run("npx", ["velocity", "--version"], installDir);
    if (version !== expectedVersion) {
      throw new Error(`unexpected installed CLI version: ${version}`);
    }
    run("npx", ["velocity", "doctor"], installDir);
    console.log(`package smoke passed (tarball=${path.basename(tarballPath)}, version=${version})`);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main();
