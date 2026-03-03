import fs from "node:fs";
import path from "node:path";
import { FrameRecord } from "./types";

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : "-";
}

export function replayTrace(tracePath: string): void {
  const absolute = path.resolve(process.cwd(), tracePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`trace not found: ${absolute}`);
  }

  const lines = fs.readFileSync(absolute, "utf8").split("\n").filter(Boolean);
  const events = lines.map((line) => JSON.parse(line) as FrameRecord);

  if (events.length === 0) {
    console.log(`trace is empty: ${absolute}`);
    return;
  }

  console.log(`trace: ${absolute}`);
  console.log(`events: ${events.length}`);
  console.log("ts direction rawB sentB batch queueMs latencyMs notes");

  for (const event of events) {
    console.log(
      `${event.ts} ${event.direction} ${event.bytesRaw} ${event.bytesSent} ${event.batchedCount} ${fmt(event.queueDelayMs)} ${fmt(event.latencyMs ?? NaN)} ${event.note ?? "-"}`,
    );
  }

  const rawBytes = events.reduce((s, e) => s + e.bytesRaw, 0);
  const sentBytes = events.reduce((s, e) => s + e.bytesSent, 0);
  const rawFrames = events.reduce((s, e) => s + e.batchedCount, 0);
  const sentFrames = events.length;
  const latencies = events.map((e) => e.latencyMs).filter((v): v is number => typeof v === "number");
  const avgLatency = latencies.length > 0 ? latencies.reduce((s, v) => s + v, 0) / latencies.length : 0;

  console.log("summary");
  console.log(`frame reduction: ${rawFrames - sentFrames}/${rawFrames}`);
  console.log(`byte reduction: ${rawBytes - sentBytes}/${rawBytes}`);
  console.log(`latency avg: ${avgLatency.toFixed(2)}ms`);
}
