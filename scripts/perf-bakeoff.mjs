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
