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
