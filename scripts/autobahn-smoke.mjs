import WebSocket from "ws";

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

async function main() {
  const ws = await connect("ws://127.0.0.1:9001");
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tool.call",
    params: { value: "smoke" },
  });

  const response = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout waiting for websocket response")), 5000);
    ws.once("message", (msg) => {
      clearTimeout(timer);
      resolve(msg.toString());
    });
    ws.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    ws.send(payload);
  });

  ws.close();

  const parsed = JSON.parse(response);
  if (parsed?.id !== 1 || parsed?.jsonrpc !== "2.0") {
    throw new Error(`unexpected response payload: ${response}`);
  }

  console.log("autobahn smoke passed");
}

main().catch((err) => {
  console.error(`autobahn smoke failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
