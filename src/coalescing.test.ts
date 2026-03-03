import assert from "node:assert/strict";
import test from "node:test";
import { SemanticCoalescer } from "./coalescing";

test("semantic coalescer suppresses duplicate JSON-RPC calls and fans out response ids", () => {
  const c = new SemanticCoalescer();
  const first = Buffer.from(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools.call",
    params: { name: "web.search", q: "velocity" },
  }), "utf8");
  const second = Buffer.from(JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools.call",
    params: { q: "velocity", name: "web.search" },
  }), "utf8");

  assert.deepEqual(c.shouldCoalesceRequest(first), { coalesced: false });
  assert.deepEqual(c.shouldCoalesceRequest(second), { coalesced: true, note: "semantic-coalesced-duplicate" });

  const response = Buffer.from(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: { ok: true },
  }), "utf8");
  const expanded = c.expandResponse(response).map((x) => JSON.parse(x.toString("utf8")) as { id: number; result: { ok: boolean } });
  assert.equal(expanded.length, 2);
  assert.deepEqual(expanded.map((x) => x.id).sort((a, b) => a - b), [1, 2]);
  assert.equal(expanded[0].result.ok, true);
  assert.equal(expanded[1].result.ok, true);
});

test("semantic coalescer ignores non-json payloads", () => {
  const c = new SemanticCoalescer();
  const raw = Buffer.from("not-json", "utf8");
  assert.deepEqual(c.shouldCoalesceRequest(raw), { coalesced: false });
  assert.equal(c.expandResponse(raw)[0].toString("utf8"), "not-json");
});
