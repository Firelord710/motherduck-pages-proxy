/**
 * BigInt-safe JSON serialization + Web Response helpers used by the proxy
 * handler. Zero deps; safe to import from /server, /client, and /validator
 * entry points.
 */

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);

/**
 * JSON.stringify replacer that converts BigInts to plain numbers when in
 * the JS-safe integer range, and to strings otherwise (preserves precision
 * for huge values). All other values pass through unchanged.
 *
 * Why: pg's default INT8 mapping returns strings, but a custom type-parser
 * or future pg version may return BigInt. JSON.stringify throws on bigint
 * by default; this replacer handles it without losing arithmetic correctness
 * downstream.
 */
export function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value !== "bigint") return value;
  if (value >= MIN_SAFE_BIGINT && value <= MAX_SAFE_BIGINT) return Number(value);
  return value.toString();
}

/** JSON.stringify with the BigInt-safe replacer. */
export function safeStringify(data: unknown): string {
  return JSON.stringify(data, jsonReplacer);
}

/** Wrap a JSON-serializable payload in a Web Response with the right header. */
export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(safeStringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Standard `{ error: { code, message } }` error response shape. */
export function errResponse(
  code: string,
  message: string,
  status: number,
): Response {
  return jsonResponse({ error: { code, message } }, status);
}
