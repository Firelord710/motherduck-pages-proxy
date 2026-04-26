/**
 * Client entry point. Currently exposes only the React hook factory.
 * No default-configured hook is exported on purpose — defaulting to
 * `/api/query` would couple this package to a specific deploy convention.
 * Build your own with one line:
 *
 *   export const useSQLQueryProxy = createSQLQueryProxyHook({
 *     proxyPath: import.meta.env.VITE_QUERY_PROXY_PATH ?? "/api/query",
 *   });
 */

export { createSQLQueryProxyHook } from "./hook.js";
export type {
  ClientConfig,
  UseSQLQueryOptions,
  UseSQLQueryResult,
} from "./hook.js";
