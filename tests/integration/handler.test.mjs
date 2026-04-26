/**
 * End-to-end handler test using a fake `pg.Client`. Validates the full
 * request pipeline (auth → rate-limit → parse → validate → connect →
 * query → response) without standing up a real Postgres server.
 *
 * Run with: node --test tests/integration/handler.test.mjs (after `npm run build`).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// Inject a fake client factory through the package's clientFactory option.
// Avoids monkey-patching the read-only pg ESM binding entirely.
class FakeClient {
  constructor(opts) {
    this.opts = opts;
    this.connected = false;
  }
  async connect() {
    this.connected = true;
  }
  async query(sql) {
    if (sql === "SELECT 1") {
      return {
        fields: [{ name: "?column?" }],
        rows: [{ "?column?": 1 }],
      };
    }
    if (sql.startsWith("SELECT * FROM matches LIMIT 1")) {
      return {
        fields: [{ name: "id" }, { name: "name" }],
        rows: [{ id: 42n, name: "Test Match" }],
      };
    }
    if (sql.startsWith("SELECT")) {
      return { fields: [], rows: [] };
    }
    throw new Error(`unexpected sql: ${sql}`);
  }
  async end() {
    this.connected = false;
  }
}

const fakeClientFactory = (cfg) => new FakeClient(cfg);

const { createWorkerHandler } = await import("../../dist/server/index.js");

const handler = createWorkerHandler({
  database: "app",
  auth: { type: "none" },
  rateLimit: false,
  connection: { clientFactory: fakeClientFactory },
});

const env = { MOTHERDUCK_TOKEN: "fake-token" };
const ctx = { waitUntil() {} };

test("OPTIONS returns 204", async () => {
  const req = new Request("https://example.com/api/query", { method: "OPTIONS" });
  const res = await handler(req, env, ctx);
  assert.equal(res.status, 204);
});

test("GET returns 405", async () => {
  const req = new Request("https://example.com/api/query", { method: "GET" });
  const res = await handler(req, env, ctx);
  assert.equal(res.status, 405);
  const body = await res.json();
  assert.equal(body.error.code, "METHOD_NOT_ALLOWED");
});

test("POST without body returns 400 BAD_REQUEST", async () => {
  const req = new Request("https://example.com/api/query", {
    method: "POST",
    body: "not-json",
    headers: { "Content-Type": "application/json" },
  });
  const res = await handler(req, env, ctx);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, "BAD_REQUEST");
});

test("POST with empty sql returns 400 BAD_REQUEST", async () => {
  const req = new Request("https://example.com/api/query", {
    method: "POST",
    body: JSON.stringify({ sql: "" }),
    headers: { "Content-Type": "application/json" },
  });
  const res = await handler(req, env, ctx);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, "BAD_REQUEST");
});

test("SELECT 1 returns rows", async () => {
  const req = new Request("https://example.com/api/query", {
    method: "POST",
    body: JSON.stringify({ sql: "SELECT 1" }),
    headers: { "Content-Type": "application/json" },
  });
  const res = await handler(req, env, ctx);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.columns, ["?column?"]);
  assert.equal(body.rows[0]["?column?"], 1);
});

test("DROP TABLE rejected by validator (never reaches pg)", async () => {
  const req = new Request("https://example.com/api/query", {
    method: "POST",
    body: JSON.stringify({ sql: "DROP TABLE matches" }),
    headers: { "Content-Type": "application/json" },
  });
  const res = await handler(req, env, ctx);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, "FORBIDDEN_SQL");
});

test("REPLACE INTO rejected with REPLACE INTO message", async () => {
  const req = new Request("https://example.com/api/query", {
    method: "POST",
    body: JSON.stringify({
      sql: "WITH x AS (REPLACE INTO m VALUES (1) RETURNING *) SELECT 1",
    }),
    headers: { "Content-Type": "application/json" },
  });
  const res = await handler(req, env, ctx);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, "FORBIDDEN_SQL");
  assert.match(body.error.message, /REPLACE INTO/);
});

test("Multi-statement rejected", async () => {
  const req = new Request("https://example.com/api/query", {
    method: "POST",
    body: JSON.stringify({ sql: "SELECT 1; DROP TABLE x" }),
    headers: { "Content-Type": "application/json" },
  });
  const res = await handler(req, env, ctx);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, "FORBIDDEN_SQL");
});

test("BigInt in row data serializes as Number when in safe range", async () => {
  const req = new Request("https://example.com/api/query", {
    method: "POST",
    body: JSON.stringify({ sql: "SELECT * FROM matches LIMIT 1" }),
    headers: { "Content-Type": "application/json" },
  });
  const res = await handler(req, env, ctx);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.rows[0].id, 42); // BigInt(42) -> Number(42) via safeStringify
  assert.equal(body.rows[0].name, "Test Match");
});

test("No connection config returns 500 CONFIG", async () => {
  const req = new Request("https://example.com/api/query", {
    method: "POST",
    body: JSON.stringify({ sql: "SELECT 1" }),
    headers: { "Content-Type": "application/json" },
  });
  const res = await handler(req, {}, ctx); // empty env
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.error.code, "CONFIG");
});

test("Custom auth strategy gates access", async () => {
  const handlerAuthed = createWorkerHandler({
    database: "app",
    auth: {
      type: "custom",
      verify: (req) => {
        const token = req.headers.get("X-Auth-Token");
        if (token === "secret") return { ok: true, user: { id: "owner" } };
        return { ok: false, reason: "missing_token" };
      },
    },
    rateLimit: false,
    connection: { clientFactory: fakeClientFactory },
  });

  const reqDenied = new Request("https://example.com/api/query", {
    method: "POST",
    body: JSON.stringify({ sql: "SELECT 1" }),
    headers: { "Content-Type": "application/json" },
  });
  const resDenied = await handlerAuthed(reqDenied, env, ctx);
  assert.equal(resDenied.status, 401);
  const bodyDenied = await resDenied.json();
  assert.equal(bodyDenied.error.code, "UNAUTHORIZED");
  assert.equal(bodyDenied.error.message, "missing_token");

  const reqAllowed = new Request("https://example.com/api/query", {
    method: "POST",
    body: JSON.stringify({ sql: "SELECT 1" }),
    headers: { "Content-Type": "application/json", "X-Auth-Token": "secret" },
  });
  const resAllowed = await handlerAuthed(reqAllowed, env, ctx);
  assert.equal(resAllowed.status, 200);
});

test("Rate limit binding triggers 429", async () => {
  let calls = 0;
  const rateLimitedEnv = {
    ...env,
    RATE_LIMITER: {
      async limit() {
        calls++;
        return { success: calls <= 2 };
      },
    },
  };
  const handlerRl = createWorkerHandler({
    database: "app",
    auth: { type: "none" },
    connection: { clientFactory: fakeClientFactory },
  });
  const makeReq = () =>
    new Request("https://example.com/api/query", {
      method: "POST",
      body: JSON.stringify({ sql: "SELECT 1" }),
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "1.2.3.4" },
    });
  assert.equal((await handlerRl(makeReq(), rateLimitedEnv, ctx)).status, 200);
  assert.equal((await handlerRl(makeReq(), rateLimitedEnv, ctx)).status, 200);
  const res3 = await handlerRl(makeReq(), rateLimitedEnv, ctx);
  assert.equal(res3.status, 429);
  const body = await res3.json();
  assert.equal(body.error.code, "RATE_LIMITED");
});
