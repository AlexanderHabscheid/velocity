#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function toSnakeCase(input) {
  return input
    .replace(/([A-Z])/g, '_$1')
    .replace(/^_/, '')
    .toLowerCase();
}

function collectOperationIds(openapiText) {
  const ids = new Set();
  const re = /^\s*operationId:\s*([A-Za-z0-9_]+)\s*$/gm;
  let m;
  while ((m = re.exec(openapiText)) !== null) {
    ids.add(m[1]);
  }
  return ids;
}

function collectTsMethods(tsText) {
  const methods = new Set();
  const re = /\basync\s+([A-Za-z0-9_]+)\s*\(/g;
  let m;
  while ((m = re.exec(tsText)) !== null) {
    methods.add(m[1]);
  }
  return methods;
}

function collectPyMethods(pyText) {
  const methods = new Set();
  const re = /^\s*def\s+([A-Za-z0-9_]+)\s*\(/gm;
  let m;
  while ((m = re.exec(pyText)) !== null) {
    methods.add(m[1]);
  }
  return methods;
}

function collectPyCliCommands(cliText) {
  const commands = new Set();
  const re = /add_parser\("([a-z0-9-]+)"\)/g;
  let m;
  while ((m = re.exec(cliText)) !== null) {
    commands.add(m[1]);
  }
  return commands;
}

const repoRoot = process.cwd();
const openapiPath = path.join(repoRoot, 'openapi/control-plane.yaml');
const tsSdkPath = path.join(repoRoot, 'sdk/typescript/src/index.ts');
const pySdkPath = path.join(repoRoot, 'sdk/python/velocity_control_sdk/client.py');
const pyCliPath = path.join(repoRoot, 'sdk/python/velocity_control_sdk/cli.py');

const openapiText = fs.readFileSync(openapiPath, 'utf8');
const tsSdkText = fs.readFileSync(tsSdkPath, 'utf8');
const pySdkText = fs.readFileSync(pySdkPath, 'utf8');
const pyCliText = fs.readFileSync(pyCliPath, 'utf8');

const operationIds = collectOperationIds(openapiText);
const tsMethods = collectTsMethods(tsSdkText);
const pyMethods = collectPyMethods(pySdkText);
const pyCliCommands = collectPyCliCommands(pyCliText);

const expectedCli = new Map([
  ['getTenantPolicy', 'get-policy'],
  ['putTenantPolicy', 'put-policy'],
  ['checkTenantRateLimit', 'check-rate-limit'],
  ['getRuntimeProfile', 'get-runtime-profile'],
  ['putRuntimeProfile', 'put-runtime-profile'],
]);

const failures = [];

for (const operationId of operationIds) {
  if (!tsMethods.has(operationId)) {
    failures.push(`typescript sdk missing method for operationId '${operationId}'`);
  }

  const pyMethod = toSnakeCase(operationId);
  if (!pyMethods.has(pyMethod)) {
    failures.push(`python sdk missing method '${pyMethod}' for operationId '${operationId}'`);
  }

  const cliCommand = expectedCli.get(operationId);
  if (cliCommand && !pyCliCommands.has(cliCommand)) {
    failures.push(`python cli missing command '${cliCommand}' for operationId '${operationId}'`);
  }
}

if (failures.length > 0) {
  console.error('contract check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`contract check passed (${operationIds.size} operationIds)`);
