export function tryMergeJsonRpcBatch(frames: Buffer[]): Buffer | null {
  if (frames.length < 2) {
    return null;
  }

  const parsed: unknown[] = [];
  for (const frame of frames) {
    try {
      const item = JSON.parse(frame.toString("utf8")) as Record<string, unknown>;
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }
      if (item.jsonrpc !== "2.0" || typeof item.method !== "string") {
        return null;
      }
      parsed.push(item);
    } catch {
      return null;
    }
  }

  return Buffer.from(JSON.stringify(parsed), "utf8");
}

export function splitJsonRpcBatchResponse(frame: Buffer): Buffer[] | null {
  try {
    const parsed = JSON.parse(frame.toString("utf8")) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return null;
    }

    const pieces: Buffer[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }
      const obj = item as Record<string, unknown>;
      if (obj.jsonrpc !== "2.0") {
        return null;
      }
      pieces.push(Buffer.from(JSON.stringify(obj), "utf8"));
    }
    return pieces;
  } catch {
    return null;
  }
}
