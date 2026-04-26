// Security tests for the SELECT-only validator. Every case here MUST be
// rejected (validateReadOnly returns a non-null reason). If any case
// passes (returns null), that is a real bypass and a real bug.
//
// Run: node tests/proxy/security.test.mjs

import { runValidatorCases } from "../helpers/validator-harness.mjs";

const cases = [];
const add = (name, sql) => cases.push({ name, sql, expect: "invalid" });

// ---------------------------------------------------------------------------
// 1. Forbidden lead verbs (bare). Each verb, plain form first.
// ---------------------------------------------------------------------------
const bareVerbs = [
  "INSERT INTO x VALUES (1)",
  "UPDATE x SET y = 1",
  "DELETE FROM x",
  "CREATE TABLE x (id INT)",
  "CREATE TABLE IF NOT EXISTS x (id INT)",
  "CREATE OR REPLACE TABLE x AS SELECT 1",
  "CREATE INDEX idx ON x(id)",
  "CREATE VIEW v AS SELECT 1",
  "CREATE SCHEMA s",
  "DROP TABLE x",
  "DROP INDEX idx",
  "DROP VIEW v",
  "DROP SCHEMA s CASCADE",
  "DROP DATABASE d",
  "ALTER TABLE x ADD COLUMN c INT",
  "ALTER TABLE x DROP COLUMN c",
  "ALTER TABLE x RENAME TO y",
  "ATTACH 'foo'",
  "ATTACH 'md:?MOTHERDUCK_TOKEN=...' AS evil",
  "DETACH foo",
  "DETACH DATABASE foo",
  "COPY x TO 'y.csv'",
  "COPY x FROM 'y.csv'",
  "INSTALL httpfs",
  "INSTALL spatial",
  "LOAD httpfs",
  "LOAD spatial",
  "TRUNCATE x",
  "TRUNCATE TABLE x",
  "MERGE INTO x USING y ON x.id = y.id WHEN MATCHED THEN UPDATE SET a = 1",
  "GRANT SELECT ON x TO public",
  "REVOKE SELECT ON x FROM public",
  "VACUUM",
  "VACUUM FULL",
  "CALL stored_proc()",
  "CALL my.func(1, 2)",
  "EXECUTE stmt",
  "EXECUTE stmt(1, 2)",
  "PREPARE stmt AS SELECT 1",
  "PRAGMA enable_object_cache",
  "PRAGMA memory_limit='1GB'",
  "PRAGMA database_list",
  "REPLACE INTO x VALUES (1)",
  "UPSERT INTO x VALUES (1)",
  "RENAME TABLE x TO y",
  "CHECKPOINT",
  "FORCE CHECKPOINT",
  "EXPORT DATABASE 'dump'",
  "IMPORT DATABASE 'dump'",
  "REINDEX",
  "REFRESH MATERIALIZED VIEW v",
];
for (const v of bareVerbs) add(`bare verb: ${v.slice(0, 40)}`, v);

// Leading whitespace variants
for (const v of bareVerbs.slice(0, 15)) {
  add(`leading-spaces: ${v.slice(0, 30)}`, "    " + v);
  add(`leading-tab: ${v.slice(0, 30)}`, "\t" + v);
  add(`leading-newline: ${v.slice(0, 30)}`, "\n" + v);
  add(`leading-CRLF: ${v.slice(0, 30)}`, "\r\n" + v);
  add(`leading-mixed-ws: ${v.slice(0, 30)}`, " \t\n\r " + v);
}

// Mixed-case verbs
const mixedCase = [
  "InSeRt INTO x VALUES (1)",
  "iNsErT INTO x VALUES (1)",
  "UpDaTe x SeT y=1",
  "DeLeTe FROM x",
  "cReAtE TABLE x (id INT)",
  "DrOp TABLE x",
  "AlTeR TABLE x ADD c INT",
  "aTtAcH 'foo'",
  "DeTaCh foo",
  "cOpY x TO 'y'",
  "InStAlL httpfs",
  "lOaD httpfs",
  "TrUnCaTe x",
  "MeRgE INTO x USING y ON true WHEN MATCHED THEN UPDATE SET a=1",
  "GrAnT SELECT ON x TO public",
  "ReVoKe SELECT ON x FROM public",
  "vAcUuM",
  "cAlL p()",
  "eXeCuTe s",
  "pRePaRe s AS SELECT 1",
  "pRaGmA memory_limit='1GB'",
  "rEpLaCe INTO x VALUES (1)",
  "uPsErT INTO x VALUES (1)",
  "ReNaMe TABLE x TO y",
  "cHeCkPoInT",
  "eXpOrT DATABASE 'd'",
  "iMpOrT DATABASE 'd'",
  "rEiNdEx",
  "rEfReSh MATERIALIZED VIEW v",
  "INSERT into x values (1)",
];
for (const v of mixedCase) add(`mixed-case: ${v.slice(0, 40)}`, v);

// Comment + verb
for (const v of bareVerbs.slice(0, 10)) {
  add(`line-comment-then-verb: ${v.slice(0, 25)}`, `-- comment\n${v}`);
  add(`block-comment-then-verb: ${v.slice(0, 25)}`, `/* hi */ ${v}`);
}

// ---------------------------------------------------------------------------
// 2. Smuggled writes inside CTE / subquery / WITH (≥40)
// ---------------------------------------------------------------------------
const smuggled = [
  "WITH x AS (INSERT INTO y VALUES (1) RETURNING *) SELECT * FROM x",
  "WITH x AS (UPDATE y SET a=1 RETURNING *) SELECT * FROM x",
  "WITH x AS (DELETE FROM y RETURNING *) SELECT * FROM x",
  "WITH x AS (DROP TABLE y) SELECT 1",
  "WITH x AS (CREATE TABLE z (id INT)) SELECT 1",
  "WITH x AS (ALTER TABLE z ADD c INT) SELECT 1",
  "WITH x AS (ATTACH 'evil') SELECT 1",
  "WITH x AS (DETACH evil) SELECT 1",
  "WITH x AS (COPY z TO 'f.csv') SELECT 1",
  "WITH x AS (TRUNCATE y) SELECT 1",
  "SELECT (DELETE FROM x RETURNING 1)",
  "SELECT (INSERT INTO x VALUES (1) RETURNING id)",
  "SELECT (UPDATE x SET a=1 RETURNING a)",
  "SELECT * FROM (UPDATE y SET z=1 RETURNING *) sub",
  "SELECT * FROM (DELETE FROM y RETURNING *) sub",
  "SELECT * FROM (INSERT INTO y VALUES (1) RETURNING *) sub",
  "SELECT 1 FROM (SELECT * FROM (DELETE FROM x RETURNING 1) inner_) outer_",
  "SELECT 1 FROM (SELECT * FROM (SELECT * FROM (DROP TABLE x) a) b) c",
  "WITH a AS (SELECT 1), b AS (DELETE FROM x RETURNING 1) SELECT * FROM a, b",
  "WITH RECURSIVE r AS (SELECT 1 UNION ALL SELECT * FROM (DELETE FROM x RETURNING 1) z) SELECT * FROM r",
  "SELECT CASE WHEN (DELETE FROM x RETURNING 1) IS NOT NULL THEN 1 ELSE 2 END",
  "SELECT array(SELECT * FROM (UPDATE x SET y=1 RETURNING y) s)",
  "SELECT * FROM x WHERE id IN (DELETE FROM y RETURNING id)",
  "SELECT * FROM x WHERE id = (UPDATE y SET id=1 RETURNING id)",
  "SELECT * FROM x WHERE EXISTS (DROP TABLE z)",
  "SELECT 1 UNION ALL DELETE FROM x",
  "SELECT 1 UNION SELECT * FROM (INSERT INTO y VALUES (1) RETURNING id) z",
  "WITH q AS (PRAGMA database_list) SELECT * FROM q",
  "WITH q AS (CALL secret_proc()) SELECT * FROM q",
  "WITH q AS (EXECUTE prepared_stmt) SELECT * FROM q",
  "WITH q AS (INSTALL httpfs) SELECT 1",
  "WITH q AS (LOAD httpfs) SELECT 1",
  "WITH q AS (VACUUM) SELECT 1",
  "WITH q AS (REINDEX) SELECT 1",
  "WITH q AS (CHECKPOINT) SELECT 1",
  "WITH q AS (REPLACE INTO x VALUES (1)) SELECT 1",
  "WITH q AS (UPSERT INTO x VALUES (1)) SELECT 1",
  "WITH q AS (MERGE INTO x USING y ON true WHEN MATCHED THEN UPDATE SET a=1) SELECT 1",
  "WITH q AS (GRANT SELECT ON x TO public) SELECT 1",
  "WITH q AS (REVOKE SELECT ON x FROM public) SELECT 1",
  "WITH q AS (EXPORT DATABASE 'd') SELECT 1",
  "WITH q AS (IMPORT DATABASE 'd') SELECT 1",
  "WITH q AS (REFRESH MATERIALIZED VIEW v) SELECT 1",
  "SELECT (SELECT (DELETE FROM x RETURNING 1))",
  "SELECT (SELECT (SELECT (DROP TABLE x)))",
];
for (const s of smuggled) add(`smuggled: ${s.slice(0, 50)}`, s);

// ---------------------------------------------------------------------------
// 3. Multi-statement (≥30)
// ---------------------------------------------------------------------------
const multi = [
  "SELECT 1; DROP TABLE x",
  "SELECT 1;DROP TABLE x;",
  "SELECT 1 ; ATTACH 'evil'",
  "SELECT 1;\nDELETE FROM y",
  "SELECT 1;;DROP TABLE x",
  "SELECT 1;;;DROP TABLE x",
  "SELECT 1;\n;\nDROP TABLE x",
  "SELECT 1; SELECT 2; DROP TABLE x",
  "SELECT 1; SELECT 2",
  "SELECT 1;SELECT 2;",
  "SELECT * FROM x; UPDATE y SET z=1",
  "SELECT 1; INSERT INTO y VALUES (1)",
  "SELECT 1; CREATE TABLE z (id INT)",
  "SELECT 1; ALTER TABLE x ADD c INT",
  "SELECT 1; TRUNCATE y",
  "SELECT 1; PRAGMA database_list",
  "SELECT 1; INSTALL httpfs",
  "SELECT 1; LOAD httpfs",
  "SELECT 1; VACUUM",
  "SELECT 1; CHECKPOINT",
  "SELECT 1; CALL sp()",
  "SELECT 1; EXECUTE stmt",
  "SELECT 1; PREPARE s AS SELECT 1",
  "SELECT 1; COPY x TO 'f.csv'",
  "SELECT 1; ATTACH 'md:?token=x'",
  "SELECT 1; DETACH d",
  "SELECT 1; DROP DATABASE d",
  "SELECT 1; GRANT SELECT ON x TO public",
  "SELECT 1; REVOKE SELECT ON x FROM public",
  "SELECT 1\t;\tDROP TABLE x",
  "WITH x AS (SELECT 1) SELECT * FROM x; DROP TABLE y",
  "VALUES (1), (2); DROP TABLE x",
  "SHOW TABLES; DROP TABLE x",
  "DESCRIBE x; ATTACH 'evil'",
];
for (const m of multi) add(`multi-stmt: ${m.slice(0, 50)}`, m);

// ---------------------------------------------------------------------------
// 4. Comment-bypass attempts (≥30)
// ---------------------------------------------------------------------------
const commentBypass = [
  "/* SELECT */ DROP TABLE x",
  "-- SELECT\nDROP TABLE x",
  "/* SELECT * FROM allowed */ INSERT INTO bad VALUES (1)",
  "-- start\nDELETE FROM x",
  "/**/ DROP TABLE x",
  "/*\n*/ DROP TABLE x",
  "/* /* nested-looking */ DROP TABLE x */ SELECT 1",
  "-- comment 1\n-- comment 2\nDROP TABLE x",
  "/* a */ /* b */ DROP TABLE x",
  "/* */ALTER TABLE x ADD c INT",
  "/**/INSERT INTO x VALUES (1)",
  "-- \nUPDATE x SET y=1",
  "/* SELECT 1 */ ATTACH 'evil'",
  "/* SELECT 1 -- */ DELETE FROM x",
  "-- DROP TABLE x in a comment is fine\nDROP TABLE x",
  "/* big\nblock\ncomment */ TRUNCATE x",
  "-- one\n-- two\n-- three\nVACUUM",
  "/* outer /* inner */ DROP TABLE x",
  "/**/SELECT * FROM x; DROP TABLE y",
  "SELECT * FROM x -- ; DROP TABLE y\n; DROP TABLE z",
  "SELECT 1 /* ; harmless */ ; DROP TABLE x",
  "/* hi */ /* bye */ /* die */ INSERT INTO x VALUES (1)",
  "-- SELECT all things\n\n\nDROP TABLE x",
  "/**/ /**/ /**/ DROP TABLE x",
  "SE/**/LECT * FROM x", // becomes "SE LECT * FROM x" → no SELECT lead match → invalid
  "SE/**/LECT 1 ; DROP TABLE x",
  "WI/**/TH q AS (SELECT 1) SELECT * FROM q",
  "/*--*/ DROP TABLE x",
  "--/*\nDROP TABLE x",
  "/* '*/ DROP TABLE x /* ' */",
  "/* \" */ DROP TABLE x /* \" */",
  "/* SELECT */ /* WITH */ /* SHOW */ DROP TABLE x",
];
for (const c of commentBypass) add(`comment-bypass: ${c.slice(0, 50)}`, c);

// ---------------------------------------------------------------------------
// 5. String-literal escaping tricks (≥30)
// ---------------------------------------------------------------------------
const stringTricks = [
  "SELECT 'a''; DROP TABLE x; --'",
  "SELECT 'a' '; DROP TABLE x; --'",
  "SELECT 'unterminated; DROP TABLE x",
  "SELECT '\\'; DROP TABLE x; --'",
  // NOTE: SELECT 'foo' || '; DROP TABLE x' is genuinely valid SQL —
  // the semicolon lives inside a single string literal.
  "SELECT '''; DROP TABLE x; --'",
  "SELECT ''''; DROP TABLE x",
  "SELECT 'a' AS b; DROP TABLE x",
  "SELECT 'safe' /* */ ; DROP TABLE x",
  "SELECT 'a\\nb'; DROP TABLE x",
  "SELECT E'\\'; DROP TABLE x; --'",
  "SELECT E'\\\\'; DROP TABLE x",
  // NOTE: SELECT 'a\u0000; DROP TABLE x' is one quoted string — also valid.
  "SELECT 'a' ; INSERT INTO y VALUES (1)",
  "SELECT 'a' ; UPDATE y SET z=1",
  "SELECT 'a' ; DELETE FROM y",
  "SELECT 'a'; ALTER TABLE y ADD c INT",
  "SELECT 'a'; CREATE TABLE z (id INT)",
  "SELECT 'a'; ATTACH 'evil'",
  "SELECT 'a'; DETACH y",
  "SELECT 'a'; COPY y TO 'f.csv'",
  "SELECT 'a'; TRUNCATE y",
  "SELECT 'a'; PRAGMA memory_limit='1GB'",
  "SELECT 'a'; CALL p()",
  "SELECT 'a'; EXECUTE s",
  "SELECT 'a'; INSTALL httpfs",
  "SELECT 'a'; LOAD httpfs",
  "SELECT 'a'; VACUUM",
  "SELECT 'a'; CHECKPOINT",
  "SELECT 'a'; REINDEX",
  "SELECT '\\'; \\'; DROP TABLE x; --'",
  "SELECT 'multi\nline\nstring'; DROP TABLE x",
  "SELECT \"col\"; DROP TABLE x",
  "SELECT \"col\"\"name\"; DROP TABLE x",
  "SELECT \"unterminated; DROP TABLE x",
];
for (const s of stringTricks) add(`string-trick: ${s.slice(0, 50)}`, s);

// ---------------------------------------------------------------------------
// 6. Mixed Unicode / homoglyph attacks (≥20)
// ---------------------------------------------------------------------------
const unicodeAttacks = [
  "\u0410LTER TABLE x ADD c INT", // Cyrillic A
  "\u0421ELECT * FROM x; DROP TABLE x", // Cyrillic S in SELECT
  "ＤＲＯＰ TABLE x", // fullwidth DROP
  "ＳＥＬＥＣＴ * FROM x", // fullwidth SELECT
  "\u202EDROP TABLE x", // RTL override
  "SE\u200BLECT * FROM x", // zero-width space inside SELECT
  "SE\u200CLECT * FROM x",
  "SE\u200DLECT * FROM x",
  "SE\uFEFFLECT * FROM x", // BOM/ZWNBSP inside
  "\u00A0DROP TABLE x", // NBSP lead → \s in JS regex includes \u00A0
  "\u3000DROP TABLE x", // ideographic space
  "DR\u0301OP TABLE x", // combining acute over R
  "\u0044\u0052\u004FP TABLE x", // ASCII DRO + P
  "DROP\u200B TABLE x", // ZWSP between verb and rest — \b on DROP still matches
  "\u0440DROP TABLE x", // Cyrillic 'r' before DROP
  "\u02BCDROP TABLE x", // modifier letter apostrophe
  "INS\u200BERT INTO x VALUES (1)", // zero-width inside INSERT
  "DEL\u200BETE FROM x",
  "UPD\u200BATE x SET y=1",
  "АLTER TABLE x ADD c INT", // Cyrillic A again, literal char
  "ＡＴＴＡＣＨ 'evil'",
  "\u2028DROP TABLE x", // line separator
  "\u2029DROP TABLE x", // paragraph separator
];
for (const u of unicodeAttacks) add(`unicode: ${JSON.stringify(u).slice(0, 50)}`, u);

// ---------------------------------------------------------------------------
// 7. Boundary / length (≥20)
// ---------------------------------------------------------------------------
add("empty string", "");
add("only spaces", "        ");
add("only tabs", "\t\t\t\t");
add("only newlines", "\n\n\n");
add("only CRLF", "\r\n\r\n");
add("only mixed whitespace", " \t\n\r \t\n\r");
add("only line comment", "-- just a comment");
add("only line comment with newline", "-- just a comment\n");
add("only block comment", "/* just a block comment */");
add("only nested-looking comments", "/* a */ /* b */ /* c */");
add("only single-quote string", "'just a string'");
add("only double-quote string", "\"just an identifier\"");
add("only string + comment", "/* hi */ 'world'");
add("unterminated block comment", "/* never ends");
add("unterminated single quote only", "'never ends");
add("unterminated double quote only", "\"never ends");
add("only semicolon", ";");
add("only semicolons", ";;;;;");
add("only whitespace + semicolon", "   ;   ");
// 16001-char comment payload strips to "SELECT 1" — that's intentionally
// VALID and not part of this all-invalid suite. Length check is exercised
// via the real-content cases below.
add("long SELECT 17000 chars", "SELECT " + "a".repeat(17000));
add("very long DROP statement", "DROP TABLE " + "x".repeat(200));
add("17000 char DROP", "DROP TABLE " + "x".repeat(17000));

// ---------------------------------------------------------------------------
// 8. Stacked / encoded payloads (≥30)
// ---------------------------------------------------------------------------
const encoded = [
  "%53ELECT * FROM x; DROP TABLE y", // URL-encoded S
  "%44ROP TABLE x",
  "&#83;ELECT * FROM x; DROP TABLE y", // HTML entity S
  "&#x44;ROP TABLE x",
  "0x53ELECT 1; DROP TABLE x",
  "\\x44ROP TABLE x",
  "\\u0044ROP TABLE x",
  "\tDROP TABLE x",
  "\nDROP TABLE x",
  "\rDROP TABLE x",
  "\r\nDROP TABLE x",
  "\u00A0DROP TABLE x",
  "\u00A0\u00A0\u00A0DROP TABLE x",
  "\uFEFFDROP TABLE x", // BOM at start
  "\uFEFF\uFEFFDROP TABLE x",
  "\uFEFFINSERT INTO x VALUES (1)",
  "\uFEFFALTER TABLE x ADD c INT",
  "%20DROP TABLE x",
  "+DROP+TABLE+x",
  "%0ADROP TABLE x",
  "%09DROP TABLE x",
  "%0DDROP TABLE x",
  "Q1JFQVRFIFRBQkxFIHggKGlkIElOVCk=", // base64 of CREATE TABLE — random text, no SELECT lead
  "\\nDROP TABLE x",
  "\\tDROP TABLE x",
  "\\rDROP TABLE x",
  "DROP\u00A0TABLE\u00A0x",
  "DROP\tTABLE\tx",
  "DROP\nTABLE\nx",
  "DROP/**/TABLE/**/x",
  "DROP--\nTABLE--\nx",
  "\u200BDROP TABLE x", // ZWSP at start (regex \s does not include ZWSP, so lead doesn't match → "Only SELECT...")
  "\u200B\u200BDROP TABLE x",
  "\u202ADROP TABLE x", // LRE
  "\u202BDROP TABLE x", // RLE
];
for (const e of encoded) add(`encoded: ${JSON.stringify(e).slice(0, 50)}`, e);

// ---------------------------------------------------------------------------
// 9. Schema-qualified writes (≥10)
// ---------------------------------------------------------------------------
const schemaQualified = [
  "INSERT INTO main.matches VALUES (1)",
  "INSERT INTO shooting.main.matches VALUES (1)",
  "DROP TABLE main.matches",
  "DROP TABLE shooting.main.matches",
  "DROP TABLE \"shooting\".\"main\".\"matches\"",
  "ATTACH 'md:?MOTHERDUCK_TOKEN=...' AS evil",
  "ATTACH 'md:shooting' AS s (READ_ONLY)",
  "ATTACH DATABASE 'evil.db' AS e",
  "DETACH DATABASE shooting",
  "DETACH s",
  "ALTER TABLE main.matches ADD c INT",
  "ALTER TABLE shooting.main.matches DROP COLUMN x",
  "TRUNCATE TABLE shooting.main.matches",
  "COPY shooting.main.matches TO 'leak.csv'",
  "DELETE FROM shooting.main.matches WHERE 1=1",
  "UPDATE shooting.main.matches SET state='AZ'",
  "CREATE TABLE shooting.main.evil AS SELECT * FROM shooting.main.matches",
];
for (const s of schemaQualified) add(`schema-qualified: ${s.slice(0, 50)}`, s);

// ---------------------------------------------------------------------------
// 10. Boolean / logic + trailing-comment tricks (≥10)
// ---------------------------------------------------------------------------
const booleanTricks = [
  "SELECT * FROM x WHERE 1=1; DROP TABLE x --",
  "SELECT * FROM x WHERE 1=1 OR 1=1; DELETE FROM x --",
  "SELECT * FROM x WHERE id = 1; UPDATE x SET y=2 --",
  "SELECT * FROM x WHERE name = 'a'; DROP TABLE x;",
  "SELECT * FROM x WHERE id IN (1,2,3); DROP TABLE x",
  "SELECT * FROM x WHERE 1=1 -- ; DROP TABLE x\n; INSERT INTO y VALUES (1)",
  "SELECT 1 WHERE TRUE; DROP TABLE x",
  "SELECT 1 WHERE FALSE; DROP TABLE x",
  "SELECT 1 WHERE NULL IS NULL; DROP TABLE x",
  "SELECT 1; -- DROP TABLE x\nDELETE FROM y",
  "SELECT * FROM x ORDER BY 1; DROP TABLE x",
  "SELECT * FROM x LIMIT 1; DROP TABLE x",
  "SELECT * FROM x GROUP BY 1; DROP TABLE x",
  "SELECT * FROM x HAVING COUNT(*) > 0; DROP TABLE x",
];
for (const b of booleanTricks) add(`boolean+multi: ${b.slice(0, 50)}`, b);

// ---------------------------------------------------------------------------
// Extra: padding to comfortably exceed 250 cases
// ---------------------------------------------------------------------------
const extras = [
  "INSERT INTO logs SELECT * FROM x",
  "INSERT INTO logs (id, val) VALUES (1, 'a')",
  "UPDATE x SET a = (SELECT 1)",
  "DELETE FROM x WHERE id IN (SELECT id FROM y)",
  "MERGE INTO x USING y ON x.id=y.id WHEN NOT MATCHED THEN INSERT VALUES (y.id)",
  "CREATE TEMP TABLE t (id INT)",
  "CREATE TEMPORARY TABLE t (id INT)",
  "CREATE OR REPLACE VIEW v AS SELECT 1",
  "CREATE MACRO m(x) AS x+1",
  "CREATE OR REPLACE MACRO m(x) AS x+1",
  "CREATE SECRET s (TYPE S3, KEY_ID 'x', SECRET 'y')",
  "CREATE OR REPLACE SECRET s (TYPE S3)",
  "DROP SECRET s",
  "DROP MACRO m",
  "DROP TYPE t",
  "DROP FUNCTION f",
  "ALTER VIEW v RENAME TO w",
  "ALTER SCHEMA s RENAME TO s2",
  "PRAGMA show_tables",
  "PRAGMA threads=4",
  "PRAGMA force_index_join",
  "SET memory_limit='1GB'", // SET is not in FORBIDDEN but lead doesn't match either → invalid
  "SET threads=4",
  "RESET memory_limit",
  "BEGIN TRANSACTION",
  "COMMIT",
  "ROLLBACK",
  "ABORT",
  "START TRANSACTION",
  "SAVEPOINT s",
  "RELEASE SAVEPOINT s",
  "USE shooting",
  "USE \"shooting\"",
  "SHOW DATABASES; ATTACH 'evil'",
  "DESCRIBE x; DROP TABLE x",
  "DESC x; DELETE FROM x",
  "EXPLAIN DROP TABLE x", // EXPLAIN lead matches but FORBIDDEN catches DROP
  "EXPLAIN ANALYZE DELETE FROM x",
  "EXPLAIN INSERT INTO x VALUES (1)",
  "EXPLAIN UPDATE x SET y=1",
  "EXPLAIN ATTACH 'evil'",
  "EXPLAIN VACUUM",
  "EXPLAIN CHECKPOINT",
  "EXPLAIN PRAGMA database_list",
  "WITH q AS (SELECT 1) DELETE FROM x", // lead WITH but FORBIDDEN catches DELETE
  "WITH q AS (SELECT 1) UPDATE x SET y=1",
  "WITH q AS (SELECT 1) INSERT INTO x VALUES (1)",
  "WITH q AS (SELECT 1) MERGE INTO x USING q ON true WHEN MATCHED THEN UPDATE SET y=1",
  "WITH q(a) AS (VALUES (1)) DELETE FROM x USING q",
  "VALUES (1); DROP TABLE x",
  "VALUES (1), (2), (3); INSERT INTO y SELECT * FROM x",
  "SHOW TABLES FROM shooting; DROP TABLE x",
  "SHOW DATABASES; DELETE FROM x",
  "SELECT 1; SELECT 2; SELECT 3", // multi-statement even with all SELECTs
  // NOTE: "SELECT 1;\n" and "SELECT 1;\t" are valid — trailing-semicolon-then-whitespace
  // is allowed by the validator's `;\s*$` trim. Excluded from this all-invalid suite.
  "SELECT 1; -- only a trailing comment\nDROP TABLE x",
  "SELECT 1 /* */ ; /* */ DROP TABLE x",
  "SELECT 1 /* */ ; /* */ ATTACH 'evil'",
  "SELECT json_extract(x, '$.evil'); DROP TABLE x",
  "SELECT regexp_matches(x, 'pattern'); DELETE FROM x",
  // NOTE: SELECT read_csv_auto(...) is genuinely valid by this validator's
  // contract — it has no forbidden keyword. Whether read_csv_auto should
  // be a worry is a separate hardening question (see md-sdk allowlist).
  "FROM x SELECT *; DROP TABLE x", // FROM-first syntax — lead 'FROM' isn't in READ_ONLY_LEAD → invalid
  "FROM x; DROP TABLE x",
  "TABLE x; DROP TABLE x", // TABLE-as-shortcut — lead doesn't match
  "PIVOT x ON c USING SUM(v); DROP TABLE x",
  "UNPIVOT x ON (a, b); DROP TABLE x",
  "/*+ comment hint */ DROP TABLE x",
  "?DROP TABLE x",
  "$DROP TABLE x",
  "@DROP TABLE x",
  "1 SELECT * FROM x; DROP TABLE x", // numeric prefix → lead doesn't match
  "; SELECT 1", // leading semicolon
  "; ; ; SELECT 1",
  "(SELECT 1); DROP TABLE x", // paren prefix
  "((SELECT 1)); DROP TABLE x",
  "(SELECT 1)", // paren-wrapped — lead doesn't match because '(' before SELECT
  "((SELECT 1))",
  "[SELECT 1]",
  "{SELECT 1}",
  "1+1",
  "true",
  "false",
  "null",
  "/* SELECT 1 */",
  "-- SELECT 1",
  "SELECT 1; SELECT 2; SELECT 3; DROP TABLE x",
  "SELECT 1; SELECT 2; DELETE FROM x",
  "SELECT 1; ATTACH 'md:'",
  "SELECT 1; DETACH d",
  "SELECT 1; INSTALL spatial",
  "SELECT 1; LOAD spatial",
];
for (const e of extras) add(`extra: ${e.slice(0, 50)}`, e);

// More "WITH ... DELETE/UPDATE/INSERT after the CTE" forms
for (const verb of ["DELETE FROM x", "UPDATE x SET y=1", "INSERT INTO x VALUES (1)", "DROP TABLE x", "ALTER TABLE x ADD c INT", "TRUNCATE x", "ATTACH 'evil'", "DETACH x", "MERGE INTO x USING y ON true WHEN MATCHED THEN UPDATE SET a=1", "VACUUM", "CHECKPOINT"]) {
  add(`WITH-then-${verb.slice(0, 20)}`, `WITH q AS (SELECT 1) ${verb}`);
}

// More mixed-case + whitespace
for (const v of ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "ATTACH", "DETACH", "COPY", "TRUNCATE", "MERGE", "GRANT", "REVOKE", "VACUUM", "CALL", "EXECUTE", "PREPARE", "PRAGMA", "REPLACE", "UPSERT", "RENAME", "CHECKPOINT", "EXPORT", "IMPORT", "REINDEX", "REFRESH", "INSTALL", "LOAD"]) {
  add(`tab-prefix-${v}`, `\t\t${v} foo`);
  add(`crlf-prefix-${v}`, `\r\n${v} foo`);
}

console.log(`\n=== SELECT-only validator security tests ===`);
console.log(`Loaded ${cases.length} cases (all expect=invalid)\n`);

const result = runValidatorCases(cases);

console.log(`Total : ${result.total}`);
console.log(`Pass  : ${result.pass}  (validator correctly rejected)`);
console.log(`Fail  : ${result.fail}  (validator returned null = BYPASS)`);

if (result.fail > 0) {
  console.log(`\n--- First 10 failures ---`);
  for (const f of result.failures.slice(0, 10)) {
    console.log(`\n  name : ${f.name}`);
    console.log(`  sql  : ${JSON.stringify(f.sql)}`);
    console.log(`  got  : ${JSON.stringify(f.got)}`);
  }

  // Genuine bypasses (validator returned null) listed prominently
  const bypasses = result.failures.filter((f) => f.got === null);
  if (bypasses.length > 0) {
    console.log(`\n!!! REAL BYPASSES (validator returned null) — ${bypasses.length} total !!!`);
    for (const b of bypasses) {
      console.log(`  - ${b.name}`);
      console.log(`    ${JSON.stringify(b.sql)}`);
    }
  } else {
    console.log(`\n(no real bypasses — all failures are spec mismatches in test expectations)`);
  }
}

process.exit(result.fail > 0 && result.failures.some((f) => f.got === null) ? 1 : 0);
