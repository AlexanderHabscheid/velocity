import { VelocityEnvelope } from "./types";

const WIRE_VARINT = 0;
const WIRE_LEN = 2;

function encodeVarint(value: number): Buffer {
  let n = Math.max(0, Math.floor(value));
  const out: number[] = [];
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return Buffer.from(out);
}

function decodeVarint(data: Uint8Array, offset: number): { value: number; next: number } | null {
  let result = 0;
  let shift = 0;
  let cursor = offset;
  while (cursor < data.length && shift <= 56) {
    const byte = data[cursor];
    result += (byte & 0x7f) * (2 ** shift);
    cursor += 1;
    if ((byte & 0x80) === 0) {
      return { value: result, next: cursor };
    }
    shift += 7;
  }
  return null;
}

function writeTag(field: number, wireType: number): Buffer {
  return encodeVarint((field << 3) | wireType);
}

function writeVarintField(field: number, value: number): Buffer {
  return Buffer.concat([writeTag(field, WIRE_VARINT), encodeVarint(value)]);
}

function writeBoolField(field: number, value: boolean): Buffer {
  return writeVarintField(field, value ? 1 : 0);
}

function writeStringField(field: number, value: string): Buffer {
  const body = Buffer.from(value, "utf8");
  return Buffer.concat([writeTag(field, WIRE_LEN), encodeVarint(body.length), body]);
}

function writeBytesField(field: number, value: Uint8Array): Buffer {
  const body = Buffer.from(value);
  return Buffer.concat([writeTag(field, WIRE_LEN), encodeVarint(body.length), body]);
}

function skipField(data: Uint8Array, wireType: number, offset: number): number | null {
  if (wireType === 0) {
    const parsed = decodeVarint(data, offset);
    return parsed?.next ?? null;
  }
  if (wireType === 1) {
    return offset + 8 <= data.length ? offset + 8 : null;
  }
  if (wireType === 2) {
    const len = decodeVarint(data, offset);
    if (!len) {
      return null;
    }
    const next = len.next + len.value;
    return next <= data.length ? next : null;
  }
  if (wireType === 5) {
    return offset + 4 <= data.length ? offset + 4 : null;
  }
  return null;
}

function decodeLen(data: Uint8Array, offset: number): { value: Uint8Array; next: number } | null {
  const len = decodeVarint(data, offset);
  if (!len) {
    return null;
  }
  const end = len.next + len.value;
  if (end > data.length) {
    return null;
  }
  return { value: data.subarray(len.next, end), next: end };
}

function encodeCapabilities(cap: NonNullable<VelocityEnvelope["control"]>["capabilities"]): Buffer {
  const parts: Buffer[] = [];
  parts.push(writeVarintField(1, cap.protocolVersion));
  parts.push(writeBoolField(2, cap.msgpack));
  parts.push(writeBoolField(3, cap.zstd));
  parts.push(writeBoolField(4, cap.delta));
  parts.push(writeBoolField(5, cap.batching));
  parts.push(writeBoolField(6, cap.adaptiveBatching));
  parts.push(writeVarintField(7, cap.latencyBudgetMs));
  parts.push(writeVarintField(8, cap.batchWindowMs));
  if (typeof cap.zstdDictionary === "boolean") {
    parts.push(writeBoolField(9, cap.zstdDictionary));
  }
  if (typeof cap.protobuf === "boolean") {
    parts.push(writeBoolField(10, cap.protobuf));
  }
  return Buffer.concat(parts);
}

function decodeCapabilities(data: Uint8Array): NonNullable<VelocityEnvelope["control"]>["capabilities"] | null {
  const out: NonNullable<VelocityEnvelope["control"]>["capabilities"] = {
    protocolVersion: 0,
    msgpack: true,
    zstd: false,
    delta: false,
    batching: true,
    adaptiveBatching: true,
    latencyBudgetMs: 0,
    batchWindowMs: 0,
    zstdDictionary: false,
    protobuf: false,
  };
  let offset = 0;
  while (offset < data.length) {
    const tag = decodeVarint(data, offset);
    if (!tag) {
      return null;
    }
    offset = tag.next;
    const field = tag.value >> 3;
    const wire = tag.value & 0x7;
    if (field === 1 && wire === WIRE_VARINT) {
      const v = decodeVarint(data, offset);
      if (!v) {
        return null;
      }
      out.protocolVersion = v.value;
      offset = v.next;
      continue;
    }
    if (field >= 2 && field <= 6 && wire === WIRE_VARINT) {
      const v = decodeVarint(data, offset);
      if (!v) {
        return null;
      }
      const bool = v.value !== 0;
      if (field === 2) {
        out.msgpack = bool;
      } else if (field === 3) {
        out.zstd = bool;
      } else if (field === 4) {
        out.delta = bool;
      } else if (field === 5) {
        out.batching = bool;
      } else if (field === 6) {
        out.adaptiveBatching = bool;
      }
      offset = v.next;
      continue;
    }
    if ((field === 7 || field === 8) && wire === WIRE_VARINT) {
      const v = decodeVarint(data, offset);
      if (!v) {
        return null;
      }
      if (field === 7) {
        out.latencyBudgetMs = v.value;
      } else {
        out.batchWindowMs = v.value;
      }
      offset = v.next;
      continue;
    }
    if ((field === 9 || field === 10) && wire === WIRE_VARINT) {
      const v = decodeVarint(data, offset);
      if (!v) {
        return null;
      }
      if (field === 9) {
        out.zstdDictionary = v.value !== 0;
      } else {
        out.protobuf = v.value !== 0;
      }
      offset = v.next;
      continue;
    }
    const skipped = skipField(data, wire, offset);
    if (skipped === null) {
      return null;
    }
    offset = skipped;
  }
  return out;
}

function encodeControl(control: NonNullable<VelocityEnvelope["control"]>): Buffer {
  const parts: Buffer[] = [];
  parts.push(writeVarintField(1, control.type === "hello" ? 1 : 2));
  if (control.ackFor) {
    parts.push(writeStringField(2, control.ackFor));
  }
  parts.push(writeBytesField(3, encodeCapabilities(control.capabilities)));
  return Buffer.concat(parts);
}

function decodeControl(data: Uint8Array): NonNullable<VelocityEnvelope["control"]> | null {
  let type: "hello" | "hello-ack" = "hello";
  let ackFor: string | undefined;
  let capabilities: NonNullable<VelocityEnvelope["control"]>["capabilities"] | null = null;
  let offset = 0;
  while (offset < data.length) {
    const tag = decodeVarint(data, offset);
    if (!tag) {
      return null;
    }
    offset = tag.next;
    const field = tag.value >> 3;
    const wire = tag.value & 0x7;
    if (field === 1 && wire === WIRE_VARINT) {
      const v = decodeVarint(data, offset);
      if (!v) {
        return null;
      }
      type = v.value === 2 ? "hello-ack" : "hello";
      offset = v.next;
      continue;
    }
    if (field === 2 && wire === WIRE_LEN) {
      const v = decodeLen(data, offset);
      if (!v) {
        return null;
      }
      ackFor = Buffer.from(v.value).toString("utf8");
      offset = v.next;
      continue;
