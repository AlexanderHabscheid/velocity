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
