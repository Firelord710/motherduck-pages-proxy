/**
 * Server entry point. All exports needed to mount the proxy on a Pages
 * Function or standalone Worker.
 */

export { createQueryProxy, createWorkerHandler } from "./handler.js";
export type { QueryProxyConfig } from "./handler.js";
export type { ConnectionConfig } from "./connection.js";
export { buildClient } from "./connection.js";
export type { RateLimitConfig, RateLimitOutcome } from "./rate-limit.js";
export { applyRateLimit, getClientIP } from "./rate-limit.js";
export type { AuthStrategy, AuthResult } from "./auth.js";
export { applyAuth } from "./auth.js";
export {
  validateReadOnly,
  stripCommentsAndLiterals,
  READ_ONLY_LEAD,
  FORBIDDEN,
  REPLACE_WRITE,
} from "./validator.js";
export {
  jsonReplacer,
  safeStringify,
  jsonResponse,
  errResponse,
} from "./json.js";
