import net from 'node:net';
import { WebSocketServer } from 'ws';

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

const port = process.env.K6_WS_PORT ? Number(process.env.K6_WS_PORT) : await openPort();
const wss = new WebSocketServer({ host: '127.0.0.1', port });

wss.on('connection', (socket) => {
  socket.on('message', (data, isBinary) => {
    socket.send(data, { binary: isBinary });
  });
});

console.log(`K6_WS_TARGET=ws://127.0.0.1:${port}`);
