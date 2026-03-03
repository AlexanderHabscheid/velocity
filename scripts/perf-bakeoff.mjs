import net from 'node:net';
import { performance } from 'node:perf_hooks';
import WebSocket, { WebSocketServer } from 'ws';

function openPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('failed to bind ephemeral port'));
        return;
      }
      server.close((err) => (err ? reject(err) : resolve(address.port)));
    });
  });
}

async function runWsRoundtrip(url, messages, payloadBytes) {
  const payload = 'x'.repeat(payloadBytes);
  const latencies = [];
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });

  for (let i = 0; i < messages; i += 1) {
    const sentAt = performance.now();
    socket.send(JSON.stringify({ id: i, payload }));
    await new Promise((resolve, reject) => {
      const onMessage = () => {
        latencies.push(performance.now() - sentAt);
        socket.off('error', onError);
        resolve();
      };
      const onError = (err) => {
        socket.off('message', onMessage);
        reject(err);
      };
      socket.once('message', onMessage);
      socket.once('error', onError);
    });
  }

  socket.close();
  const avg = latencies.reduce((sum, v) => sum + v, 0) / Math.max(1, latencies.length);
  const sorted = [...latencies].sort((a, b) => a - b);
  const p95 = sorted[Math.floor((sorted.length - 1) * 0.95)] ?? 0;
  return { avgMs: avg, p95Ms: p95, messages };
}

async function withWsEchoServer(port, fn) {
  const server = new WebSocketServer({ host: '127.0.0.1', port });
  server.on('connection', (socket) => socket.on('message', (data, isBinary) => socket.send(data, { binary: isBinary })));
  try {
    return await fn(`ws://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

async function withUwsEchoServer(port, fn) {
  let uws;
  try {
    uws = await import('uWebSockets.js');
  } catch {
    return null;
  }

  const app = uws.default.App();
  app.ws('/*', {
    message: (ws, message, isBinary) => ws.send(message, isBinary),
  });

  await new Promise((resolve, reject) => {
    app.listen('127.0.0.1', port, (token) => {
      if (!token) {
        reject(new Error('uWebSockets.js failed to listen'));
        return;
      }
      resolve();
    });
  });

  try {
    return await fn(`ws://127.0.0.1:${port}`);
