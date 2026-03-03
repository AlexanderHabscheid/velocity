import assert from "node:assert/strict";
import test from "node:test";
import { encode } from "@msgpack/msgpack";
import { VelocityCodec } from "./codec";
import { VelocityEnvelope } from "./types";

test("codec parses valid serialized envelope", async () => {
  const codec = new VelocityCodec(false);
  await codec.init();

  const envelope: VelocityEnvelope = {
    kind: "single",
    id: "test-id",
    sentAt: Date.now(),
    frames: [Buffer.from("hello")],
    source: "velocity",
  };

  const serialized = await codec.serialize(envelope);
  const parsed = await codec.parse(serialized.buffer);
  assert.ok(parsed);
  assert.equal(parsed.envelope.kind, "single");
  assert.equal(parsed.envelope.id, "test-id");
  assert.equal(Buffer.from(parsed.envelope.frames[0]).toString("utf8"), "hello");
});

test("codec rejects invalid envelope shape", async () => {
  const codec = new VelocityCodec(false);
  await codec.init();

  const invalid = {
    kind: "single",
    id: "",
    sentAt: Date.now(),
    frames: [],
  };

  const packed = Buffer.from(encode(invalid));
  const frame = Buffer.concat([Buffer.from([0]), packed]);
  const parsed = await codec.parse(frame);
