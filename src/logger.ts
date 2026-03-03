export type LogFormat = "text" | "json";
export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogFields {
  [key: string]: unknown;
}

export interface Logger {
  debug: (message: string, fields?: LogFields) => void;
  info: (message: string, fields?: LogFields) => void;
  warn: (message: string, fields?: LogFields) => void;
  error: (message: string, fields?: LogFields) => void;
}

export function createLogger(format: LogFormat): Logger {
  const write = (level: LogLevel, message: string, fields?: LogFields): void => {
    if (format === "json") {
      const payload = {
        ts: new Date().toISOString(),
        level,
        message,
        ...(fields ?? {}),
      };
      const line = `${JSON.stringify(payload)}\n`;
      if (level === "error" || level === "warn") {
        process.stderr.write(line);
      } else {
        process.stdout.write(line);
      }
      return;
    }

    const parts = [`[${level}]`, message];
    if (fields && Object.keys(fields).length > 0) {
      parts.push(JSON.stringify(fields));
    }
    const line = `${parts.join(" ")}\n`;
    if (level === "error" || level === "warn") {
      process.stderr.write(line);
    } else {
