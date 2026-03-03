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
