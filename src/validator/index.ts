/**
 * Browser-safe entry point. Pulls in only the pure validator + JSON
 * helpers — no `pg`, no React. Keep this surface tiny so consumers can
 * use it for cheap pre-flight validation in a SQL editor without
 * inflating their bundle.
 */

export {
  validateReadOnly,
  stripCommentsAndLiterals,
  READ_ONLY_LEAD,
  FORBIDDEN,
  REPLACE_WRITE,
} from "../server/validator.js";

export {
  jsonReplacer,
  safeStringify,
} from "../server/json.js";
