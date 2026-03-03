import fs from "node:fs";
import path from "node:path";
import { FrameRecord } from "./types";

export function loadOutboundReduction(traceRoot: string): { frameReductionPct: number; byteReductionPct: number } {
  if (!fs.existsSync(traceRoot)) {
    return { frameReductionPct: 0, byteReductionPct: 0 };
  }

  let rawFrames = 0;
  let sentFrames = 0;
  let rawBytes = 0;
  let sentBytes = 0;

  for (const file of fs.readdirSync(traceRoot)) {
    if (!file.endsWith(".jsonl")) {
      continue;
    }
    const full = path.join(traceRoot, file);
    const lines = fs.readFileSync(full, "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      const event = JSON.parse(line) as FrameRecord;
      if (event.direction !== "agent->server") {
        continue;
      }
      rawFrames += event.batchedCount;
      sentFrames += 1;
      rawBytes += event.bytesRaw;
      sentBytes += event.bytesSent;
    }
  }

  const frameReductionPct = rawFrames > 0 ? ((rawFrames - sentFrames) / rawFrames) * 100 : 0;
  const byteReductionPct = rawBytes > 0 ? ((rawBytes - sentBytes) / rawBytes) * 100 : 0;
  return { frameReductionPct, byteReductionPct };
}
