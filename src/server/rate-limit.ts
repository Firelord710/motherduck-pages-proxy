/**
 * Per-IP rate limit helper. Uses Cloudflare's first-class rate-limit
 * binding when present; fails open silently when the binding is missing
 * or throws. Caller decides whether failing open is acceptable.
 */

export interface RateLimitConfig {
  /** Env binding name. Default: `"RATE_LIMITER"`. */
  bindingName?: string;
}

/** Cloudflare rate-limit binding shape. */
interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export type RateLimitOutcome =
  | { ok: true }
  | { ok: false; response: Response };

/** Best-effort caller IP extraction. Falls back through CF / standard headers. */
export function getClientIP(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

/**
 * Apply per-IP rate limiting if the binding is configured. When the
 * binding is absent, missing, or throws, returns `{ ok: true }` — fail-open
 * by design so a missing binding doesn't 500 the user.
 */
export async function applyRateLimit(
  env: Record<string, unknown>,
  request: Request,
  config?: RateLimitConfig | false,
  /** Optional override for the rate-limit key (e.g. user id when authenticated). */
  keyOverride?: string,
): Promise<RateLimitOutcome> {
  if (config === false) return { ok: true };
  const bindingName = config?.bindingName ?? "RATE_LIMITER";
  const binding = env[bindingName] as RateLimitBinding | undefined;
  if (!binding || typeof binding.limit !== "function") return { ok: true };
  const key = keyOverride ?? getClientIP(request);
  try {
    const { success } = await binding.limit({ key });
    if (success) return { ok: true };
    const body = JSON.stringify({
      error: { code: "RATE_LIMITED", message: "Too many requests" },
    });
    return {
      ok: false,
      response: new Response(body, {
        status: 429,
        headers: { "Content-Type": "application/json" },
      }),
    };
  } catch {
    // Misconfigured binding — fail open
    return { ok: true };
  }
}
