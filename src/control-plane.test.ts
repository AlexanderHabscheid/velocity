import assert from "node:assert/strict";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startControlPlaneWithOptions } from "./control-plane";

async function getOpenPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("failed to bind open port"));
        return;
      }
      server.close((err) => (err ? reject(err) : resolve(address.port)));
    });
  });
}

test("control-plane persists policy and supports distributed rate-limit checks", async () => {
  const port = await getOpenPort();
  const stateFile = path.join(os.tmpdir(), `velocity-control-plane-${Date.now()}.json`);
  const handle = await startControlPlaneWithOptions({
    host: "127.0.0.1",
    port,
    storeEngine: "json",
    stateFile,
    dbPath: path.join(os.tmpdir(), `velocity-control-plane-${Date.now()}.db`),
  });

  const base = `http://127.0.0.1:${port}`;
  const tenant = encodeURIComponent("acme/co");

  const updateResp = await fetch(`${base}/v1/tenants/${tenant}/policy`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled: true, rateLimitRps: 2 }),
  });
  assert.equal(updateResp.status, 200);

  const getResp = await fetch(`${base}/v1/tenants/${tenant}/policy`);
  const policy = await getResp.json() as { rateLimitRps: number };
  assert.equal(policy.rateLimitRps, 2);

  const allow1 = await fetch(`${base}/v1/tenants/${tenant}/rate-limit/check`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rateLimitRps: 2 }),
  });
  const allow2 = await fetch(`${base}/v1/tenants/${tenant}/rate-limit/check`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rateLimitRps: 2 }),
  });
  const deny3 = await fetch(`${base}/v1/tenants/${tenant}/rate-limit/check`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rateLimitRps: 2 }),
  });

  assert.equal((await allow1.json() as { allow: boolean }).allow, true);
  assert.equal((await allow2.json() as { allow: boolean }).allow, true);
  assert.equal((await deny3.json() as { allow: boolean }).allow, false);

  await handle.close();

  const port2 = await getOpenPort();
  const handle2 = await startControlPlaneWithOptions({
    host: "127.0.0.1",
    port: port2,
    storeEngine: "json",
    stateFile,
    dbPath: path.join(os.tmpdir(), `velocity-control-plane-${Date.now()}-2.db`),
  });

  const persistedResp = await fetch(`http://127.0.0.1:${port2}/v1/tenants/${tenant}/policy`);
  const persistedPolicy = await persistedResp.json() as { rateLimitRps: number };
  assert.equal(persistedPolicy.rateLimitRps, 2);
