/**
 * Auth strategy adapter. Three strategies:
 *
 *   - `none`     : no check (default; fine for owner-only or already
 *                  edge-gated deployments).
 *   - `cfAccess` : verify the `Cf-Access-Jwt-Assertion` header against a
 *                  Cloudflare Access team's JWKS. Uses Web Crypto only;
 *                  no Node deps.
 *   - `custom`   : delegate to a user-supplied verify callback.
 *
 * Important: do NOT trust a JWT just because the header exists. The
 * `cfAccess` strategy fetches JWKS, verifies the RS256 signature with
 * `crypto.subtle.verify`, checks `aud` / `iss` / `exp`, and only then
 * returns ok. Module-level cache amortizes JWKS fetch across requests.
 */

import { errResponse } from "./json.js";

export type AuthStrategy =
  | { type: "none" }
  | {
      type: "cfAccess";
      /** e.g. "yourteam.cloudflareaccess.com" */
      teamDomain: string;
      /** Application Audience tag from the CF Access UI. */
      audience: string;
    }
  | {
      type: "custom";
      verify: (
        request: Request,
        env: Record<string, unknown>,
      ) =>
        | Promise<
            { ok: true; user?: unknown } | { ok: false; reason: string }
          >
        | { ok: true; user?: unknown }
        | { ok: false; reason: string };
    };

export interface AuthResult {
  ok: boolean;
  /** Opaque identity payload (JWT claims, custom callback return, etc.). */
  user?: unknown;
  /** When ok=false, the response to return to the client (401 typically). */
  response?: Response;
}

// ---------------------------------------------------------------------------
// CF Access JWKS verification (Web Crypto only)
// ---------------------------------------------------------------------------

interface JwksCacheEntry {
  fetchedAt: number;
  keys: Map<string, CryptoKey>;
}

const JWKS_TTL_MS = 60 * 60 * 1000;
const jwksCache = new Map<string, JwksCacheEntry>();

function base64UrlDecode(input: string): string {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4;
  return atob(pad ? b64 + "=".repeat(4 - pad) : b64);
}

function base64UrlToBytes(input: string): ArrayBuffer {
  const decoded = base64UrlDecode(input);
  const buf = new ArrayBuffer(decoded.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < decoded.length; i++) view[i] = decoded.charCodeAt(i);
  return buf;
}

async function getJwks(teamDomain: string): Promise<Map<string, CryptoKey>> {
  const hit = jwksCache.get(teamDomain);
  if (hit && Date.now() - hit.fetchedAt < JWKS_TTL_MS) return hit.keys;
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const payload = (await res.json()) as { keys: Array<JsonWebKey & { kid?: string }> };
  const imported = new Map<string, CryptoKey>();
  for (const jwk of payload.keys) {
    if (!jwk.kid) continue;
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    imported.set(jwk.kid, key);
  }
  jwksCache.set(teamDomain, { fetchedAt: Date.now(), keys: imported });
  return imported;
}

interface CfAccessJwtClaims {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  email?: string;
  sub?: string;
  [key: string]: unknown;
}

async function verifyCfAccessJwt(
  jwt: string,
  teamDomain: string,
  audience: string,
): Promise<
  | { ok: true; payload: CfAccessJwtClaims }
  | { ok: false; reason: string }
> {
  const parts = jwt.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed_jwt" };
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  let header: { alg?: string; kid?: string };
  let payload: CfAccessJwtClaims;
  try {
    header = JSON.parse(base64UrlDecode(headerB64));
    payload = JSON.parse(base64UrlDecode(payloadB64));
  } catch {
    return { ok: false, reason: "malformed_jwt" };
  }

  if (header.alg !== "RS256") return { ok: false, reason: "unsupported_alg" };
  if (!header.kid) return { ok: false, reason: "missing_kid" };

  const keys = await getJwks(teamDomain);
  const key = keys.get(header.kid);
  if (!key) return { ok: false, reason: "unknown_kid" };

  const sig = base64UrlToBytes(sigB64);
  const dataView = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  // Copy into a fresh ArrayBuffer so SharedArrayBuffer-backed views can't
  // leak in via the global crypto types.
  const data = new ArrayBuffer(dataView.byteLength);
  new Uint8Array(data).set(dataView);
  const valid = await crypto.subtle.verify(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    sig,
    data,
  );
  if (!valid) return { ok: false, reason: "bad_signature" };

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && payload.exp < now) {
    return { ok: false, reason: "expired" };
  }
  if (typeof payload.nbf === "number" && payload.nbf > now) {
    return { ok: false, reason: "not_yet_valid" };
  }
  if (payload.iss !== `https://${teamDomain}`) {
    return { ok: false, reason: "bad_iss" };
  }
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(audience)) return { ok: false, reason: "bad_aud" };

  return { ok: true, payload };
}

// ---------------------------------------------------------------------------
// Public dispatcher
// ---------------------------------------------------------------------------

/**
 * Apply the chosen auth strategy to the request. Callers branch on
 * `result.ok` — if false, return `result.response` to the client.
 */
export async function applyAuth(
  request: Request,
  env: Record<string, unknown>,
  strategy: AuthStrategy,
): Promise<AuthResult> {
  if (strategy.type === "none") return { ok: true };

  if (strategy.type === "custom") {
    const r = await strategy.verify(request, env);
    if (r.ok) return { ok: true, user: r.user };
    return {
      ok: false,
      response: errResponse("UNAUTHORIZED", r.reason, 401),
    };
  }

  // cfAccess
  const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!jwt) {
    return {
      ok: false,
      response: errResponse("UNAUTHORIZED", "missing_jwt", 401),
    };
  }
  const r = await verifyCfAccessJwt(jwt, strategy.teamDomain, strategy.audience);
  if (!r.ok) {
    return {
      ok: false,
      response: errResponse("UNAUTHORIZED", r.reason, 401),
    };
  }
  return { ok: true, user: r.payload };
}

// Test-only: drop the JWKS cache between cases.
export function __resetJwksCacheForTests(): void {
  jwksCache.clear();
}
