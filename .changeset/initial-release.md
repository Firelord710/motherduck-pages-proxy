---
"@obsidianlabs/motherduck-pages-proxy": minor
---

Initial release. Read-only SQL proxy for MotherDuck on Cloudflare Pages/Workers.

- `/server`: `createQueryProxy` (Pages Function) + `createWorkerHandler` (standalone Worker) factories
- `/client`: `createSQLQueryProxyHook` (React) — POSTs to the proxy, drop-in replacement for `useSQLQuery` from `@motherduck/react-sql-query`
- `/validator`: pure `validateReadOnly` + `safeStringify` (zero deps, browser-safe, ≤2KB gzipped)
- 1592-case validator test harness covering 4 categories: security bypass attempts, valid queries, BigInt/JSON serialization, ReDoS / unicode / length edges
- 12-case integration test suite with a fake pg client (auth, rate-limit, BigInt, multi-statement, REPLACE INTO)
- Three connection strategies: Hyperdrive binding, full pg connection string, MotherDuck PAT fallback
- Three auth strategies: `none`, `cfAccess` (real Web Crypto JWKS verify, no Node deps), `custom` (BYO callback)
- Per-IP rate-limit binding adapter (fail-open when binding absent)
