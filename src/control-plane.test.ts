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
