# @obsidianlabs/motherduck-pages-proxy

> Server-side MotherDuck query proxy + React client for Cloudflare Pages/Workers.
> SELECT-only validator, BigInt-safe JSON, pluggable auth & rate-limit.

[![CI](https://github.com/Firelord710/motherduck-pages-proxy/actions/workflows/ci.yml/badge.svg)](https://github.com/Firelord710/motherduck-pages-proxy/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@obsidianlabs/motherduck-pages-proxy)](https://www.npmjs.com/package/@obsidianlabs/motherduck-pages-proxy)
[![license](https://img.shields.io/npm/l/@obsidianlabs/motherduck-pages-proxy)](./LICENSE)

## Why

If you ship a public-facing dashboard that talks to MotherDuck via
`@motherduck/wasm-client`, the personal access token gets bundled into
the browser's JavaScript. Anyone who loads the page can extract the
token and run any query against your MD account — including writes,
since MD's free tier doesn't issue scoped read-only tokens.

This package moves the token server-side. The browser POSTs SQL to a
Cloudflare Pages Function (or standalone Worker); the function holds
the token, validates that the SQL is a single read-only statement,
optionally rate-limits per IP, then runs the query via `pg` over MD's
Postgres-wire endpoint (or via Hyperdrive for connection pooling).

You don't need this if your dashboard is private (already gated by
Cloudflare Access or similar). You do need it if any of the following
are true:

- The dashboard is public (or about to be).
- You want to ship a native iOS/Android app — they can't use the wasm
  client and need an HTTP API instead.
- You need per-user rate limiting or auth gating that can't be done
  client-side.

## Install

```bash
npm install @obsidianlabs/motherduck-pages-proxy pg
```

`pg` is a peer dependency. React and ReactDOM are optional peers
(needed only if you import the `/client` entry).

Add `compatibility_flags = ["nodejs_compat"]` to your `wrangler.toml` —
`pg` requires the Node.js compat shim on the Workers runtime.

## Quick start — Cloudflare Pages Functions

```ts
// functions/api/query.ts
import { createQueryProxy } from "@obsidianlabs/motherduck-pages-proxy/server";

export const onRequest = createQueryProxy({
  database: "shooting",
  connection: { hyperdriveBindingName: "HYPERDRIVE_SHOOTING" },
  rateLimit: { bindingName: "RATE_LIMITER" },
  auth: { type: "none" },
});
```

```tsx
// src/md-sdk.ts
import { createSQLQueryProxyHook } from "@obsidianlabs/motherduck-pages-proxy/client";

export const useSQLQueryProxy = createSQLQueryProxyHook({
  proxyPath: "/api/query",
});
```

```tsx
// src/SomeTab.tsx
import { useSQLQueryProxy } from "./md-sdk";

export function SomeTab() {
  const { data, isLoading, error } = useSQLQueryProxy<readonly { n: number }[]>(
    "SELECT count(*) AS n FROM matches",
  );
  if (isLoading) return <div>Loading…</div>;
  if (error) return <div>{error.message}</div>;
  return <div>{data?.[0].n} matches</div>;
}
```

## Quick start — standalone Cloudflare Worker

```ts
// src/index.ts
import { createWorkerHandler } from "@obsidianlabs/motherduck-pages-proxy/server";

const handler = createWorkerHandler({
  database: "shooting",
  connection: { hyperdriveBindingName: "HYPERDRIVE" },
  auth: {
    type: "cfAccess",
    teamDomain: "yourteam.cloudflareaccess.com",
    audience: "your-application-aud-tag",
  },
});

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === "/api/query") return handler(request, env, ctx);
    return new Response("Not found", { status: 404 });
  },
};
```

## Configuration

```ts
interface QueryProxyConfig {
  /** Database / catalog name (required). */
  database: string;
  /** Connection strategy overrides. Defaults map to standard binding/env names. */
  connection?: ConnectionConfig;
  /** Rate-limit binding; pass `false` to disable. Default `{ bindingName: "RATE_LIMITER" }`. */
  rateLimit?: RateLimitConfig | false;
  /** Auth strategy. Default `{ type: "none" }`. */
  auth?: AuthStrategy;
  /** Override the validator's max SQL length (default 16000). */
  maxSqlLength?: number;
  /** CORS — leave undefined for same-origin. */
  cors?: { origin?: string; methods?: string[] };
}
```

## Connection ladder

The handler tries three strategies in order, taking the first one that's
configured:

1. **Hyperdrive binding** (`env.HYPERDRIVE`) — preferred. Connection
   pooling closer to the edge, lower latency. Set `hyperdriveBindingName`
   to override the binding name.
2. **Full Postgres-wire connection string** (`env.PG_CONNECTION`) — useful
   for local dev with `wrangler pages dev`. Set `connectionStringEnvName`
   to override.
3. **MotherDuck PAT** (`env.MOTHERDUCK_TOKEN`) — fallback, builds a
   default connection string against `pg.us-east-1-aws.motherduck.com`.
   Set `motherduckTokenEnvName` to override.

If none of the three are configured, the handler returns
`500 CONFIG`.

## Auth strategies

```ts
// 1. No auth — fine for owner-only or already-edge-gated deployments
auth: { type: "none" }

// 2. Cloudflare Access JWT verify (real Web Crypto JWKS check)
auth: {
  type: "cfAccess",
  teamDomain: "yourteam.cloudflareaccess.com",
  audience: "<application-AUD-tag>",
}

// 3. Bring your own — magic-link, HMAC, IP allowlist, anything
auth: {
  type: "custom",
  verify: async (request, env) => {
    const token = request.headers.get("X-Auth-Token");
    if (!token) return { ok: false, reason: "missing_token" };
    const ok = await myAuthCheck(token, env);
    return ok ? { ok: true, user: { id: "..." } } : { ok: false, reason: "bad_token" };
  },
}
```

The `cfAccess` strategy:

- Fetches JWKS from `https://${teamDomain}/cdn-cgi/access/certs`.
- Verifies the RS256 signature with `crypto.subtle.verify`.
- Validates `aud`, `iss`, `exp`, `nbf`.
- Caches keys in-process for 1 hour to amortize JWKS fetch cost.

It does NOT trust the JWT just because the header is present — that's a
common bug in Pages Function examples. **The package always verifies the
signature.**

## Rate limiting

```ts
rateLimit: { bindingName: "RATE_LIMITER" }
```

Uses Cloudflare's [first-class rate-limit binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).
Configure the binding in your `wrangler.toml`:

```toml
[[ratelimits]]
binding = "RATE_LIMITER"
namespace_id = "1001"
simple = { limit = 30, period = 60 }
```

Or, for `unsafe` Worker projects:

```toml
[[unsafe.bindings]]
type = "ratelimit"
name = "RATE_LIMITER"
namespace_id = "1001"
simple = { limit = 30, period = 60 }
```

If the binding is absent at runtime, the handler **fails open** — no
limit enforced. Acceptable for owner-only traffic; must-fix before
opening to wider public.

> **CF Pages caveat (2026-04):** Cloudflare Pages's bundled Wrangler 3.x
> doesn't recognize the first-class `[[ratelimits]]` block — it logs a
> warning and silently drops the binding. If your Pages project is
> wrangler.toml-managed, options are: wait for the Pages Wrangler
> upgrade, remove `wrangler.toml` and configure bindings via the
> dashboard, or implement a custom KV/Durable-Object-based limiter.

## Validator semantics

The validator is regex-based, not AST-based. It accepts statements
beginning with `SELECT`, `WITH`, `SHOW`, `DESCRIBE`, `DESC`, `EXPLAIN`,
or `VALUES`. It rejects:

- Any of: `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `DROP`, `ALTER`,
  `ATTACH`, `DETACH`, `COPY`, `INSTALL`, `LOAD`, `TRUNCATE`, `MERGE`,
  `GRANT`, `REVOKE`, `VACUUM`, `CALL`, `EXECUTE`, `PREPARE`, `UPSERT`,
  `RENAME`, `REINDEX`, `REFRESH`, `EXPORT`, `IMPORT`, `CHECKPOINT`,
  `FORCE`, `PRAGMA`.
- `REPLACE INTO ...` (the write form). Bare `SELECT * REPLACE (...)`
  projection is allowed.
- Multiple statements separated by `;`.
- SQL longer than `maxSqlLength` (default 16000 chars).

Comments and string literals are stripped before keyword scanning, so
`WHERE name ILIKE '%CREATE%'` does NOT false-positive.

The 1592-case test suite (`tests/unit/`) covers the security-critical
edges. Browser bundles can also import `validateReadOnly` from
`@obsidianlabs/motherduck-pages-proxy/validator` for cheap pre-flight
validation in a SQL editor.

## Limitations

- **DuckDB dialect creep.** AST parsers like `node-sql-parser` and
  `libpg_query` fail on DuckDB-specific syntax (`SELECT * EXCLUDE`,
  `FROM-first`, `GROUP BY ALL`, `COLUMNS('regex')`). The regex
  validator is the pragmatic answer; it'll need updates if a new
  DuckDB syntax form needs to be allowed.
- **Postgres-wire only.** No HTTP transport. MotherDuck doesn't
  currently expose a non-pg SQL API for end-user queries.
- **No region multiplex.** MD's pg endpoint is a single
  `pg.us-east-1-aws.motherduck.com` host today. The package exposes
  `host` / `port` config for the day this changes.
- **Rate limiter is best-effort.** Per-isolate counters drift across
  Cloudflare PoPs; a determined attacker can multiply the budget.
  Use this as a defense-in-depth layer, not a primary security control.

## Examples

- [`examples/pages-functions/`](./examples/pages-functions/) — minimal
  Pages Functions deployment.
- [`examples/standalone-worker/`](./examples/standalone-worker/) — bare
  `fetch` handler suitable for a non-Pages Worker.

## Contributing

```bash
git clone https://github.com/Firelord710/motherduck-pages-proxy.git
cd motherduck-pages-proxy
npm install
npm run typecheck
npm run build
npm test                  # 1592 unit cases
npm run test:integration  # 12 handler-level cases with a fake pg client
```

The validator's expected case totals are documented in
[`tests/helpers/validator-harness.mjs`](./tests/helpers/validator-harness.mjs).
If a port adds or removes cases, update the totals there in the same
commit so future drift is detectable.

## License

MIT — see [LICENSE](./LICENSE).
