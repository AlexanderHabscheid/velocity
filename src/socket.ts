export interface ProxySocket {
  on(event: "open", listener: () => void): this;
  on(event: "message", listener: (data: unknown, isBinary?: boolean) => void): this;
  on(event: "pong", listener: () => void): this;
  on(event: "close", listener: () => void): this;
  on(event: "error", listener: (err?: unknown) => void): this;
  send(data: unknown, options?: { binary?: boolean }): void;
  ping?: () => void;
  close(code?: number, reason?: string): void;
  readonly readyState: number;
  readonly bufferedAmount: number;
}

export const SOCKET_STATE = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const;
