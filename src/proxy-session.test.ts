import assert from "node:assert/strict";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import WebSocket, { WebSocketServer } from "ws";
import { startProxy } from "./proxy";

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

test("proxy closes session when inbound queue exceeds limit", async () => {
  const upstreamPort = await getOpenPort();
  const proxyPort = await getOpenPort();
  const upstream = new WebSocketServer({ host: "127.0.0.1", port: upstreamPort });
  upstream.on("connection", (socket) => {
    socket.on("message", () => {
      // keep upstream quiet so queue pressure is driven by agent burst.
    });
  });

  const proxy = await startProxy({
    target: `ws://127.0.0.1:${upstreamPort}`,
    listenHost: "127.0.0.1",
    listenPort: proxyPort,
    ingressH2H3Pilot: false,
    batchWindowMs: 100,
    batchMaxMessages: 64,
    batchMaxBytes: 131072,
