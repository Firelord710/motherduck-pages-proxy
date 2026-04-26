/**
 * Pure SQL validator — server- and browser-safe. Bundled into both the
 * /server and /validator entry points so consumers can run cheap pre-flight
 * validation in the browser before sending a query to the proxy.
 *
 * The validator is REGEX-based, not AST-based. Trade-offs:
 *  - Regex is fast (slowest call ~1.7ms on 16K input), zero deps, runs
 *    natively on every Cloudflare runtime + the browser.
 *  - Regex misses some edge cases that an AST parser would catch — but
 *    `node-sql-parser` and `libpg_query` both fail on DuckDB-specific
 *    syntax (`SELECT * EXCLUDE`, `FROM-first`, `GROUP BY ALL`,
 *    `COLUMNS('regex')`), which would cause false rejections on
 *    legitimate dashboard queries.
 *
 * 1592-case test suite at tests/unit/ covers the security edges.
 */

/** Statements that may begin a read-only query. */
export const READ_ONLY_LEAD =
  /^\s*(SELECT|WITH|SHOW|DESCRIBE|DESC|EXPLAIN|VALUES)\b/i;

/**
 * Word-boundary blocklist applied to the (comment AND string-literal) stripped
 * statement. Listing the dangerous verbs explicitly is more robust than
 * "must start with SELECT" alone — it catches CTEs that smuggle a write
 * inside a WITH clause.
 *
 * Bare REPLACE is intentionally NOT in this list: DuckDB uses it as a
 * projection modifier (`SELECT * REPLACE (a AS b) FROM t`). The write form
 * `REPLACE INTO ...` is caught by REPLACE_WRITE below instead. INSERT is
 * already blocked, so `INSERT OR REPLACE` is covered by the INSERT keyword.
 */
export const FORBIDDEN =
  /\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|ATTACH|DETACH|COPY|INSTALL|LOAD|TRUNCATE|MERGE|GRANT|REVOKE|VACUUM|CALL|EXECUTE|PREPARE|UPSERT|RENAME|REINDEX|REFRESH|EXPORT|IMPORT|CHECKPOINT|FORCE|PRAGMA)\b/i;

/** Catches the write form `REPLACE INTO …` while permitting the projection form. */
export const REPLACE_WRITE = /\bREPLACE\s+INTO\b/i;

/**
 * Strip line comments, block comments, and string literals so the
 * blocklist regex doesn't false-positive on user input embedded in
 * `WHERE name ILIKE '%CREATE%'`-style filters. Returns the SQL with
 * comments and quoted bodies replaced by spaces / empty strings —
 * preserves length-like shape, never executed; only used for validation
 * scanning.
 */
export function stripCommentsAndLiterals(sql: string): string {
  return sql
    // -- line comments
    .replace(/--[^\n\r]*/g, " ")
    // /* block comments */
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    // 'single-quoted strings' (with '' as embedded quote)
    .replace(/'(?:''|[^'])*'/g, "''")
    // "double-quoted identifiers" (DuckDB) — empty out the body but keep
    // the quotes so identifier shape is preserved
    .replace(/"(?:""|[^"])*"/g, '""');
}

/**
 * Validate that the SQL is a read-only single statement. Returns null on
 * pass, or a human-readable rejection reason string.
 */
export function validateReadOnly(
  sql: string,
  options?: { maxLength?: number },
): string | null {
  const maxLength = options?.maxLength ?? 16_000;
  const stripped = stripCommentsAndLiterals(sql).trim();
  if (!stripped) return "Empty SQL";
  if (stripped.length > maxLength) {
    return `SQL too long (max ${maxLength} chars)`;
  }
  if (!READ_ONLY_LEAD.test(stripped)) {
    return "Only SELECT / WITH / SHOW / DESCRIBE / EXPLAIN queries are allowed";
  }
  if (FORBIDDEN.test(stripped)) {
    return "SQL contains a forbidden keyword (writes, DDL, ATTACH, PRAGMA, etc.)";
  }
  if (REPLACE_WRITE.test(stripped)) {
    return "REPLACE INTO is not allowed";
  }
  // Reject embedded statement separators. We strip a single trailing ';'
  // first; anything left means a multi-statement payload.
  const trimmed = stripped.replace(/;\s*$/, "");
  if (trimmed.includes(";")) return "Multiple statements not allowed";
  return null;
}
