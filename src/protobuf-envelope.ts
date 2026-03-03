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
