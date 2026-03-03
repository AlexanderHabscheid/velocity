import { EventEmitter } from "node:events";
import { IncomingHttpHeaders } from "node:http";
import { WebSocketServer } from "ws";
import { Logger } from "./logger";
import { ProxySocket, SOCKET_STATE } from "./socket";

export interface ListenerHandle {
  close: () => Promise<void>;
}

interface ListenerOptions {
  host: string;
  port: number;
  engine: "ws" | "uwebsockets";
  maxPayloadBytes?: number;
  logger: Logger;
  onConnection: (socket: ProxySocket, req: { url?: string; headers: IncomingHttpHeaders; remoteAddress?: string }) => void;
}

interface UwsRequestContext {
  url?: string;
  headers: IncomingHttpHeaders;
  remoteAddress?: string;
}

class UwsSocketAdapter extends EventEmitter implements ProxySocket {
  private readonly socket: any;
  private state: number = SOCKET_STATE.OPEN;

  constructor(socket: any) {
    super();
    this.socket = socket;
  }

  override on(event: "open" | "message" | "pong" | "close" | "error", listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  send(data: unknown, options?: { binary?: boolean }): void {
    if (this.state !== SOCKET_STATE.OPEN) {
      return;
    }
    const binary = options?.binary ?? true;
    const ok = this.socket.send(data, binary);
    if (!ok) {
      this.emit("error", new Error("uWebSockets.js send failed"));
    }
  }

  close(code?: number, reason?: string): void {
    if (this.state !== SOCKET_STATE.OPEN) {
      return;
    }
    this.state = SOCKET_STATE.CLOSING;
    try {
      this.socket.end(code, reason);
    } catch {
      // ignore close races
    }
  }

  ping(): void {
    if (this.state !== SOCKET_STATE.OPEN) {
      return;
    }
    try {
      this.socket.ping();
    } catch {
      // ignore ping races
    }
  }

  markClosed(): void {
    if (this.state === SOCKET_STATE.CLOSED) {
      return;
    }
    this.state = SOCKET_STATE.CLOSED;
    this.emit("close");
  }

  get readyState(): number {
    return this.state;
  }

  get bufferedAmount(): number {
    try {
      return this.socket.getBufferedAmount();
    } catch {
      return 0;
    }
  }
}

async function startWsListener(options: ListenerOptions): Promise<ListenerHandle> {
  const wss = new WebSocketServer({
    host: options.host,
    port: options.port,
    maxPayload: Math.max(1024, options.maxPayloadBytes ?? 100 * 1024 * 1024),
  });
  wss.on("connection", (socket, req) => {
    void Promise.resolve(options.onConnection(socket as unknown as ProxySocket, {
      url: req.url,
      headers: req.headers,
      remoteAddress: req.socket.remoteAddress,
    })).catch((err) => {
      options.logger.warn("listener connection handler failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      socket.close(1011, "listener_error");
    });
  });

  return {
    close: async () =>
      new Promise<void>((resolve, reject) => {
        for (const client of wss.clients) {
          client.close();
