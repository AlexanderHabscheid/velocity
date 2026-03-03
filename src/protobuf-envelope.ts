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

