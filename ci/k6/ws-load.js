import ws from 'k6/ws';
import { check } from 'k6';

export const options = {
  vus: 20,
  duration: '20s',
  thresholds: {
    checks: ['rate>0.99'],
  },
};

const target = __ENV.K6_WS_TARGET || 'ws://127.0.0.1:4100';

export default function () {
  const res = ws.connect(target, {}, function (socket) {
    socket.on('open', () => {
      for (let i = 0; i < 20; i += 1) {
        socket.send(JSON.stringify({ id: i, method: 'ping', params: { i } }));
      }
      socket.setTimeout(() => socket.close(), 500);
    });
  });

  check(res, {
    'status is 101': (r) => r && r.status === 101,
  });
}
