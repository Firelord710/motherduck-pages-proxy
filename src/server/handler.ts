/**
 * Request handler factory. Two flavours:
 *   - createQueryProxy(config) → Pages Function (consumed via `export const onRequest`)
 *   - createWorkerHandler(config) → bare `(req, env, ctx)` handler for standalone Workers
 *
 * Both share an identical pipeline:
 *   OPTIONS → 204
 *   non-POST → 405 METHOD_NOT_ALLOWED
 *   auth.applyAuth → 401 if not ok
 *   rate-limit.applyRateLimit → 429 if not ok
 *   parse {sql} body → 400 BAD_REQUEST if missing/invalid
 *   validateReadOnly → 400 FORBIDDEN_SQL on rejection
 *   buildClient → 500 CONFIG on missing strategy
 *   client.connect + query → 200 {columns, rows} OR 400 QUERY_ERROR
 *   finally: ctx.waitUntil(client.end())
 *
 * Wire format is preserved bit-for-bit with the original
 * shooting_dashboard/functions/api/query.ts implementation so any cached
 * old browser bundles keep working against this handler.
 */

import { applyAuth, type AuthStrategy } from "./auth.js";
import {
  applyRateLimit,
  type RateLimitConfig,
} from "./rate-limit.js";
import { buildClient, type ConnectionConfig } from "./connection.js";
import { errResponse, jsonResponse } from "./json.js";
import { validateReadOnly } from "./validator.js";

export interface QueryProxyConfig {
  /** Database / catalog name. Required. */
  database: string;
  /** Connection strategy overrides. Defaults map to standard binding/env names. */
  connection?: Omit<ConnectionConfig, "database"> & { database?: string };
  /** Rate limit binding name; pass `false` to disable. Default `{ bindingName: "RATE_LIMITER" }`. */
  rateLimit?: RateLimitConfig | false;
  /** Auth strategy. Default `{ type: "none" }`. */
  auth?: AuthStrategy;
  /** Override the validator's max SQL length (default 16000). */
  maxSqlLength?: number;
  /** CORS — leave undefined for same-origin. */
  cors?: {
    origin?: string;
    methods?: string[];
  };
}

interface ParsedBody {
  sql: unknown;
}

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

type Env = Record<string, unknown>;

async function handle(
  request: Request,
  env: Env,
  ctx: ExecutionContextLike,
  config: QueryProxyConfig,
): Promise<Response> {
  if (request.method === "OPTIONS") {
    const headers = new Headers();
    if (config.cors?.origin) {
      headers.set("Access-Control-Allow-Origin", config.cors.origin);
      headers.set(
        "Access-Control-Allow-Methods",
        (config.cors.methods ?? ["POST", "OPTIONS"]).join(", "),
      );
      headers.set("Access-Control-Allow-Headers", "Content-Type");
    }
    return new Response(null, { status: 204, headers });
  }

  if (request.method !== "POST") {
    return errResponse("METHOD_NOT_ALLOWED", "POST required", 405);
  }

  const auth = await applyAuth(
    request,
    env,
    config.auth ?? { type: "none" },
  );
  if (!auth.ok) return auth.response!;

  const rate = await applyRateLimit(env, request, config.rateLimit);
  if (!rate.ok) return rate.response;

  let body: ParsedBody;
  try {
    body = (await request.json()) as ParsedBody;
  } catch {
    return errResponse("BAD_REQUEST", "Invalid JSON body", 400);
  }

  const sql = body.sql;
  if (typeof sql !== "string" || !sql.trim()) {
    return errResponse("BAD_REQUEST", "Missing 'sql' field", 400);
  }

  const validationError = validateReadOnly(sql, {
    maxLength: config.maxSqlLength,
  });
  if (validationError) {
    return errResponse("FORBIDDEN_SQL", validationError, 400);
  }

  const connectionConfig: ConnectionConfig = {
    database: config.connection?.database ?? config.database,
    hyperdriveBindingName: config.connection?.hyperdriveBindingName,
    connectionStringEnvName: config.connection?.connectionStringEnvName,
    motherduckTokenEnvName: config.connection?.motherduckTokenEnvName,
    host: config.connection?.host,
    port: config.connection?.port,
    clientFactory: config.connection?.clientFactory,
  };

  let client;
  try {
    client = buildClient(env, connectionConfig);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return errResponse("CONFIG", message, 500);
  }

  try {
    await client.connect();
    const result = await client.query(sql);
    const columns = (result.fields ?? []).map((f) => f.name);
    return jsonResponse({ columns, rows: result.rows });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return errResponse("QUERY_ERROR", message, 400);
  } finally {
    ctx.waitUntil(client.end().catch(() => undefined));
  }
}

/** Cloudflare Pages Function factory. */
export function createQueryProxy(
  config: QueryProxyConfig,
): (context: {
  request: Request;
  env: Env;
  waitUntil(promise: Promise<unknown>): void;
}) => Promise<Response> {
  return async (context) =>
    handle(context.request, context.env, context, config);
}

/** Standalone Cloudflare Worker handler factory. */
export function createWorkerHandler(
  config: QueryProxyConfig,
): (
  request: Request,
  env: Env,
  ctx: ExecutionContextLike,
) => Promise<Response> {
  return async (request, env, ctx) => handle(request, env, ctx, config);
}
