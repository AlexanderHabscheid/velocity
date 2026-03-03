import { WebSocketServer } from 'ws';

const port = Number(process.env.AUTOBAHN_WS_PORT ?? '9001');
const wss = new WebSocketServer({ host: '127.0.0.1', port });

wss.on('connection', (socket) => {
  socket.on('message', (data, isBinary) => {
    socket.send(data, { binary: isBinary });
  });
});

console.log(`autobahn target listening on ws://127.0.0.1:${port}`);
