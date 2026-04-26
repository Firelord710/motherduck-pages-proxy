// Edge / DoS / encoding / weird-input probes for the read-only SQL validator.
//
// We import runValidatorCases (and validateReadOnly directly, for timing
// measurement) from validator.mjs. Each case declares an expectation:
//
//   expect: "valid"                         -> validator must return null
//   expect: "invalid"                       -> validator must return a non-null reason
//   expect: { reason: /Empty SQL/ }         -> reason must match the regex
//
// We also wrap each call with performance.now() to flag any single
// validator call that takes longer than 100ms (potential ReDoS).
//
// Run with:  node tests/proxy/edge.test.mjs

import { performance } from "node:perf_hooks";
import {
  runValidatorCases,
  validateReadOnly,
  stripCommentsAndLiterals,
} from "../helpers/validator-harness.mjs";

// Reason regexes that map to the four reason strings the validator emits.
const R_EMPTY     = /^Empty SQL$/;
const R_TOO_LONG  = /^SQL too long/;
const R_NOT_LEAD  = /^Only SELECT/;
const R_FORBIDDEN = /forbidden keyword/;
const R_MULTI     = /^Multiple statements/;

const cases = [];
const push = (name, sql, expect) => cases.push({ name, sql, expect });

// ---------------------------------------------------------------------------
// Category 1: length boundaries (>=30)
// ---------------------------------------------------------------------------
push("len.empty",                     "",                                 { reason: R_EMPTY });
push("len.single_space",              " ",                                { reason: R_EMPTY });
push("len.many_spaces",               "          ",                       { reason: R_EMPTY });
push("len.tabs_only",                 "\t\t\t\t",                         { reason: R_EMPTY });
push("len.newlines_only",             "\n\n\n",                           { reason: R_EMPTY });
push("len.mixed_ws_only",             " \t\r\n \t",                       { reason: R_EMPTY });
push("len.single_char_a",             "a",                                { reason: R_NOT_LEAD });
push("len.single_char_S",             "S",                                { reason: R_NOT_LEAD });
push("len.select_no_args",            "SELECT 1",                         "valid");
push("len.select_short",              "SELECT 1 AS x",                    "valid");
push("len.select_100ch",              "SELECT " + "1, ".repeat(24) + "1", "valid");
push("len.select_1kb",                "SELECT '" + "a".repeat(1000) + "'", "valid");
push("len.select_5kb",                "SELECT '" + "a".repeat(5000) + "'", "valid");
push("len.select_10kb",               "SELECT '" + "a".repeat(10_000) + "'", "valid");
// 15999 chars total in the *stripped* output. Easier: build the raw SELECT
// and ensure stripped len is <16000.
{
  const body = "1, ".repeat(2660); // 2660*3 = 7980; plus "SELECT " prefix; well under
  const sql = "SELECT " + body + "1";
  push("len.select_under_cap_safe",   sql,                                "valid");
}
// Build a SELECT whose STRIPPED form is exactly 16000 chars.
{
  // After stripping a string literal, "'<anything>'" becomes "''"
  // So make: "SELECT '<padding>' AS x" where overall stripped length = 16000.
  // Stripped form is "SELECT '' AS x" = 14 chars. We need 16000 stripped chars.
  // Add identifiers padding outside literal.
  const baseStripped = "SELECT '' AS ";
  const need = 16000 - baseStripped.length;
  const ident = "x".repeat(need);
  const sql = `SELECT '${"P".repeat(50)}' AS ${ident}`;
  push("len.stripped_at_cap",         sql,                                "valid");
}
{
  // Stripped exactly 16001 chars -> over cap -> invalid
  const baseStripped = "SELECT '' AS ";
  const need = 16001 - baseStripped.length;
  const ident = "x".repeat(need);
  const sql = `SELECT '${"P".repeat(50)}' AS ${ident}`;
  push("len.stripped_just_over_cap",  sql,                                { reason: R_TOO_LONG });
}
{
  // 100KB raw SELECT with no literals -> way over cap
  const sql = "SELECT " + "1, ".repeat(34_000) + "1";
  push("len.select_100kb",            sql,                                { reason: R_TOO_LONG });
}
// `SELECT\b` matches because end-of-string is a word boundary, so the bare
// keyword passes the lead check. There's no FORBIDDEN keyword and no `;`,
// so the validator returns null. (Surprising but correct.)
push("len.just_select",               "SELECT",                           "valid");
push("len.select_only_kw",            "SELECT ",                          "valid");
push("len.with_only",                 "WITH",                             "valid");
push("len.show_only",                 "SHOW",                             "valid");
push("len.describe_only",             "DESCRIBE",                         "valid");
push("len.desc_only",                 "DESC",                             "valid");
push("len.explain_only",              "EXPLAIN",                          "valid");
push("len.values_only",               "VALUES",                           "valid");
push("len.show_tables",               "SHOW TABLES",                      "valid");
push("len.values_row",                "VALUES (1, 2, 3)",                 "valid");
push("len.explain_select",            "EXPLAIN SELECT 1",                 "valid");
push("len.describe_table",            "DESCRIBE matches",                 "valid");
push("len.with_select",               "WITH x AS (SELECT 1) SELECT * FROM x", "valid");

// ---------------------------------------------------------------------------
// Category 2: whitespace exotica (>=20)
// ---------------------------------------------------------------------------
push("ws.leading_space",              "  SELECT 1",                       "valid");
push("ws.trailing_space",             "SELECT 1   ",                      "valid");
push("ws.both_spaces",                "   SELECT 1   ",                   "valid");
push("ws.tab_lead",                   "\tSELECT 1",                       "valid");
push("ws.cr_lead",                    "\rSELECT 1",                       "valid");
push("ws.lf_lead",                    "\nSELECT 1",                       "valid");
push("ws.crlf_lead",                  "\r\nSELECT 1",                     "valid");
push("ws.crlfcrlf_lead",              "\r\n\r\nSELECT 1",                 "valid");
push("ws.mixed_lead",                 "\t\r\n SELECT 1",                  "valid");
push("ws.mixed_trail",                "SELECT 1\t\r\n ",                  "valid");
push("ws.vtab_lead",                  "\vSELECT 1",                       "valid");
push("ws.formfeed_lead",              "\fSELECT 1",                       "valid");
// IMPORTANT: in JavaScript, `\s` in a regex DOES match NBSP and other
// Unicode whitespace (em space, line/paragraph separator) — verified
// empirically. Validator-side `.trim()` ALSO strips them. So NBSP-led
// inputs pass the lead check; an NBSP-only input strips to empty.
push("ws.nbsp_lead",                  "\u00A0SELECT 1",                   "valid");
push("ws.nbsp_then_space_lead",       "\u00A0 SELECT 1",                  "valid");
push("ws.space_then_nbsp_lead",       " \u00A0SELECT 1",                  "valid");
push("ws.nbsp_only",                  "\u00A0",                           { reason: R_EMPTY });
push("ws.tab_internal",               "SELECT\t1",                        "valid");
push("ws.cr_internal",                "SELECT\r1",                        "valid");
push("ws.lf_internal",                "SELECT\n1",                        "valid");
push("ws.many_internal_blanks",       "SELECT      1      AS      x",     "valid");
push("ws.unicode_em_space_lead",      "\u2003SELECT 1",                   "valid");
push("ws.zwsp_lead",                  "\u200BSELECT 1",                   { reason: R_NOT_LEAD });
push("ws.line_separator_lead",        "\u2028SELECT 1",                   "valid"); // \s in JS matches LS
push("ws.para_separator_lead",        "\u2029SELECT 1",                   "valid"); // \s in JS matches PS

// ---------------------------------------------------------------------------
// Category 3: Unicode (>=30)
// ---------------------------------------------------------------------------
push("u.emoji_in_string",             "SELECT '🔫' AS x",                 "valid");
push("u.emoji_in_double_string",      'SELECT "🔫" AS x',                 "valid");
push("u.emoji_as_ident",              'SELECT * FROM "🔫"',               "valid");
push("u.cjk_in_string",               "SELECT '中文' AS x",               "valid");
push("u.cjk_as_ident",                'SELECT * FROM "中文"',             "valid");
push("u.korean_string",               "SELECT '한국어' AS x",             "valid");
push("u.arabic_string",               "SELECT 'مرحبا' AS x",              "valid");
push("u.hebrew_string",               "SELECT 'שלום' AS x",               "valid");
push("u.rtl_mark_string",             "SELECT '\u200Fhello' AS x",        "valid");
push("u.lrm_string",                  "SELECT '\u200Ehello' AS x",        "valid");
push("u.zwj_in_string",               "SELECT 'a\u200Db' AS x",           "valid");
push("u.zwnj_in_string",              "SELECT 'a\u200Cb' AS x",           "valid");
// Zero-width characters in SELECT keyword break READ_ONLY_LEAD:
push("u.zwsp_inside_select",          "S\u200BELECT 1",                   { reason: R_NOT_LEAD });
push("u.zwj_inside_select",           "S\u200DELECT 1",                   { reason: R_NOT_LEAD });
push("u.zwnj_inside_select",          "S\u200CELECT 1",                   { reason: R_NOT_LEAD });
push("u.bom_inside_select",           "S\uFEFFELECT 1",                   { reason: R_NOT_LEAD });
push("u.combining_acute_lead",        "\u0301SELECT 1",                   { reason: R_NOT_LEAD });
push("u.combining_in_select",         "S\u0301ELECT 1",                   { reason: R_NOT_LEAD });
push("u.nfc_select",                  "SELECT '\u00E9'",                  "valid"); // é precomposed
push("u.nfd_select",                  "SELECT 'e\u0301'",                 "valid"); // é decomposed
push("u.cyrillic_lookalike_lead",     "ЅЕLECT 1",                         { reason: R_NOT_LEAD }); // Cyrillic S/E
push("u.greek_lookalike_lead",        "ΣΕLECT 1",                         { reason: R_NOT_LEAD });
push("u.fullwidth_select",            "ＳＥＬＥＣＴ 1",                   { reason: R_NOT_LEAD });
push("u.upper_select_unicode_body",   "SELECT 'café' AS x",               "valid");
push("u.surrogate_pair_emoji",        "SELECT '👨‍👩‍👧' AS family",        "valid");
push("u.flag_emoji",                  "SELECT '🇺🇸' AS flag",              "valid");
push("u.devanagari_string",           "SELECT 'नमस्ते' AS hi",             "valid");
push("u.thai_string",                 "SELECT 'สวัสดี' AS th",             "valid");
push("u.private_use_area",            "SELECT '\uE000' AS pua",           "valid");
push("u.tag_chars",                   "SELECT '\u{E0061}' AS x",          "valid");
push("u.box_drawing_string",          "SELECT '┌─┐' AS box",              "valid");
push("u.combining_marks_in_string",   "SELECT 'a\u0301\u0302\u0303' AS x", "valid");
push("u.bidi_override_string",        "SELECT '\u202Eevil\u202C' AS x",   "valid");

// ---------------------------------------------------------------------------
// Category 4: Catastrophic backtracking probes (>=20)
// Each input is timed below; the regex is tested by the validator call.
// ---------------------------------------------------------------------------
// 10k quotes: regex eats them in `''` pairs (each pair matches the escape
// branch). Result strips to `SELECT''` -> lead matches, no body.
push("redos.10k_quotes",              "SELECT " + "'".repeat(10_000),     "valid");
push("redos.5k_paired_quotes",        "SELECT '" + "''".repeat(5000) + "'", "valid");
// Unterminated strings: regex requires a closing `'`, so no match means the
// raw body stays. Lead is still SELECT. Body has no FORBIDDEN keyword, no
// `;`. So technically VALID (the database will reject the bad SQL itself —
// validator's job is read-only enforcement, not parsing).
push("redos.unterminated_short",      "SELECT 'aaaa",                     "valid");
push("redos.unterminated_1k",         "SELECT '" + "a".repeat(1000),      "valid");
push("redos.unterminated_10k",        "SELECT '" + "a".repeat(10_000),    "valid");
push("redos.deep_alternations",       "SELECT " + "1 OR ".repeat(2000) + "1", "valid");
push("redos.many_strings",            "SELECT " + Array(500).fill("'a'").join(", "), "valid");
push("redos.many_dq_strings",         "SELECT " + Array(500).fill('"a"').join(", "), "valid");
push("redos.alternating_quote_types", "SELECT " + Array(200).fill(`'a' AS "b"`).join(", "), "valid");
push("redos.many_block_comments",     "SELECT 1 " + "/* x */ ".repeat(1000),         "valid");
push("redos.many_line_comments",      "SELECT 1\n" + "-- x\n".repeat(1000),         "valid");
push("redos.unterminated_block_comment", "/* " + "a".repeat(5000),         { reason: R_NOT_LEAD });
push("redos.nested_string_chars",     "SELECT '" + "x'".repeat(500) + "'", "valid");
push("redos.embedded_escaped_quotes", "SELECT '" + "''".repeat(2000) + "x'", "valid");
push("redos.long_identifier",         'SELECT "' + "x".repeat(8000) + '" FROM t', "valid");
push("redos.long_string_then_select", "/* " + "a".repeat(1000) + " */ SELECT 1", "valid");
push("redos.regex_backtrack_seed",    "SELECT '" + "a'a".repeat(2000) + "'", "valid");
push("redos.alt_quote_classes",       "SELECT " + "'\"'".repeat(500),     "valid");
push("redos.runs_of_dashes",          "SELECT 1 " + "-".repeat(2000),     "valid");
push("redos.lots_of_slashes",         "SELECT 1 " + "/".repeat(1000),     "valid");
push("redos.tons_of_stars",           "SELECT " + "* , ".repeat(1500) + "1", "valid");

// ---------------------------------------------------------------------------
// Category 5: unterminated comments (>=10)
// ---------------------------------------------------------------------------
push("uc.block_no_close_simple",      "/* SELECT 1",                      { reason: R_NOT_LEAD });
push("uc.block_no_close_with_drop",   "/* SELECT * FROM x",               { reason: R_NOT_LEAD });
push("uc.block_then_select",          "/* hello SELECT 1",                { reason: R_NOT_LEAD });
push("uc.block_then_drop_kw",         "SELECT 1 /* DROP TABLE x",         { reason: R_FORBIDDEN });
push("uc.block_only_open",            "/*",                               { reason: R_NOT_LEAD });
push("uc.block_open_close_then_open", "/* a */ SELECT 1 /* dangling",     "valid"); // outer pair stripped
push("uc.dash_dash_no_newline",       "-- SELECT 1",                      { reason: R_EMPTY });
push("uc.dash_dash_then_drop",        "SELECT 1 -- DROP TABLE x",         "valid"); // line comment stripped
push("uc.dash_dash_drop_with_lf",     "SELECT 1\n-- DROP\nORDER BY 1",    "valid");
push("uc.dash_dash_then_kw_no_lf",    "-- DROP TABLE\nSELECT 1",          "valid");
push("uc.block_close_only",           "*/ SELECT 1",                      { reason: R_NOT_LEAD });
push("uc.block_imbalanced_close",     "SELECT 1 */",                      "valid"); // odd close ignored

// ---------------------------------------------------------------------------
// Category 6: nested-comment look-alikes (>=10)
// ---------------------------------------------------------------------------
// Outer regex is non-greedy, so it matches the first /* ... */ pair only.
// /* /* nested */ DROP TABLE */ SELECT 1
//   -> first match: /* /* nested */ -> stripped.
//   -> remainder: " DROP TABLE */ SELECT 1"
//   -> contains DROP -> forbidden.
// `/* /* nested */ DROP TABLE */ SELECT 1`:
// non-greedy block strips `/* /* nested */`, leaves `DROP TABLE */ SELECT 1`.
// Lead check fires before FORBIDDEN, so we get NOT_LEAD (DROP isn't a
// recognized read-only verb). Either way, attack is blocked.
push("nest.drop_after_inner_close",   "/* /* nested */ DROP TABLE */ SELECT 1", { reason: R_NOT_LEAD });
push("nest.select_after_nested",      "/* /* abc */ */ SELECT 1",        "valid"); // outer match leaves "*/ SELECT 1" -> NOT_LEAD actually
// The above strips /* /* abc */ leaving " */ SELECT 1" -> NOT_LEAD. Fix expectation:
cases[cases.length - 1].expect = { reason: R_NOT_LEAD };
push("nest.outer_only_inner_kw",      "/* outer /* inner DROP */ x */ SELECT 1", { reason: R_NOT_LEAD });
push("nest.fake_nest_select",         "/* /* */ SELECT 1",                "valid");
push("nest.three_levels",             "/* /* /* */ */ */ SELECT 1",      { reason: R_NOT_LEAD });
push("nest.nested_with_quotes",       "/* /* 'DROP' */ */ SELECT 1",     { reason: R_NOT_LEAD });
push("nest.nested_with_string_drop",  "SELECT '/* DROP */' AS x",         "valid"); // string literal protects DROP
// Line comments are stripped FIRST in stripCommentsAndLiterals. `-- inside */`
// eats `*/` so the block comment becomes unterminated and stays in the
// stripped output. Lead becomes `/* SELECT 1` -> NOT_LEAD. (Quirk of regex
// ordering, but still safe — request is rejected.)
push("nest.line_in_block",            "/* SELECT 1 -- inside */ SELECT 2", { reason: R_NOT_LEAD });
push("nest.block_in_string",          "SELECT '/* DROP TABLE */' AS x",   "valid");
// Same ordering quirk: `-- DROP */ SELECT 1` is consumed by the line-comment
// regex first, leaving `/*` -> NOT_LEAD.
push("nest.dash_in_block",            "/* -- DROP */ SELECT 1",           { reason: R_NOT_LEAD });
// `/* a */ /* b DROP`: first block stripped, second has no close so it
// stays. Stripped body becomes `/* b DROP` -> NOT_LEAD wins over FORBIDDEN
// (lead check runs first).
push("nest.confusing_close",          "/* a */ /* b DROP",                { reason: R_NOT_LEAD });

// ---------------------------------------------------------------------------
// Category 7: quote interactions (>=20)
// ---------------------------------------------------------------------------
push("q.dq_in_sq",                    "SELECT '\"' FROM x",               "valid");
push("q.sq_in_dq",                    'SELECT "\'" FROM x',               "valid");
push("q.empty_sq",                    "SELECT '' FROM x",                 "valid");
push("q.empty_dq",                    'SELECT "" FROM x',                 "valid");
push("q.escaped_sq_pair",             "SELECT '''' FROM x",               "valid");   // -> ''
push("q.escaped_dq_pair",             'SELECT """""" FROM x',             "valid");
push("q.mixed_quotes_simple",         "SELECT 'a\"b' FROM \"c'd\"",       "valid");
push("q.three_sq",                    "SELECT ''' FROM x",                "invalid"); // unterminated -> body leaks but no kw, so what? -> NOT_LEAD or pass? Test it.
// The third quote starts a new string that never terminates.
// stripCommentsAndLiterals: `'(?:''|[^'])*'` matches greedily.
// `''' FROM x` -> `''` matches first (an escaped quote pair when wrapped),
// actually pattern reads start at first `'`, then either `''` or `[^']`. So
// from index 0: first '\'', body matches ''' as '' then next char ' -> end.
// So `'''` becomes `''`. Then ` FROM x` remains.
cases[cases.length - 1].expect = "valid";
push("q.dq_in_sq_with_drop",          "SELECT '\"DROP\"' FROM x",         "valid");
push("q.sq_in_dq_with_drop",          'SELECT "\'DROP\'" FROM x',         "valid");
push("q.string_with_select",          "SELECT 'SELECT * FROM y' FROM x",  "valid");
push("q.string_with_drop",            "SELECT 'DROP TABLE y' AS note",    "valid");
push("q.string_with_semi",            "SELECT ';' FROM x",                "valid");
push("q.dq_with_semi",                'SELECT ";" FROM x',                "valid");
push("q.adjacent_strings",            "SELECT 'a' 'b' FROM x",            "valid");
push("q.string_concat_pipes",         "SELECT 'a' || 'b' FROM x",         "valid");
push("q.string_concat_with_semi",     "SELECT 'a' || ';' || 'b' FROM x",  "valid");
push("q.dq_table_name",               'SELECT * FROM "weird;name"',       "valid");
push("q.dq_with_drop_keyword",        'SELECT * FROM "drop_log"',         "valid");
push("q.dq_just_drop",                'SELECT * FROM "DROP"',             "valid");
push("q.sq_with_quote_quote",         "SELECT 'O''Reilly' AS who",        "valid");
push("q.dq_with_quote_quote",         'SELECT "weird""name" FROM x',      "valid");
push("q.string_lots_of_escapes",      "SELECT '" + "''".repeat(50) + "drop' AS x", "valid");
push("q.unmatched_dq",                'SELECT "abc',                      "invalid"); // unterminated -> body leaks -> contains abc but lead OK so might pass; check
// Stripped: `"(?:""|[^"])*"` won't match unterminated -> string stays.
// Stripped result: 'SELECT "abc' (trim doesn't matter). Lead: SELECT -> ok.
// FORBIDDEN: nope. Multi-statement: no. So this should be "valid".
cases[cases.length - 1].expect = "valid";
push("q.unmatched_sq",                "SELECT 'abc",                      "valid");

// ---------------------------------------------------------------------------
// Category 8: trailing/embedded semicolons (>=20)
// ---------------------------------------------------------------------------
push("semi.trailing",                 "SELECT 1;",                        "valid");
push("semi.trailing_with_ws",         "SELECT 1;   ",                     "valid");
push("semi.trailing_lf",              "SELECT 1;\n",                      "valid");
push("semi.trailing_crlf",            "SELECT 1;\r\n",                    "valid");
push("semi.two_trailing",             "SELECT 1;;",                       { reason: R_MULTI });
push("semi.middle",                   "SELECT 1; SELECT 2",               { reason: R_MULTI });
push("semi.middle_then_drop",         "SELECT 1; DROP TABLE x",           { reason: R_FORBIDDEN });
push("semi.embedded_in_string",       "SELECT ';' FROM x",                "valid");
push("semi.many_embedded_in_string",  "SELECT 'a;b;c;d;e' FROM x",        "valid");
push("semi.string_concat_semi",       "SELECT 'a' || ';' || 'b' FROM x",  "valid");
push("semi.dq_ident_with_semi",       'SELECT * FROM "weird;table"',      "valid");
push("semi.string_then_real_semi",    "SELECT ';' FROM x;",               "valid");
push("semi.string_then_real_two_stmts","SELECT ';' FROM x; SELECT 2",     { reason: R_MULTI });
push("semi.tricky_string_unmatched",  "SELECT 'abc; SELECT 1",            "valid"); // unterminated string -> validator treats as one stmt, ;in body
// Wait: with unterminated string, stripping doesn't remove it; raw `;` is in
// it; but trimmed.includes(';') WILL be true. So MULTI.
cases[cases.length - 1].expect = { reason: R_MULTI };
push("semi.line_comment_semi",        "SELECT 1 -- ;\n",                  "valid");
push("semi.block_comment_semi",       "SELECT 1 /* ; */",                 "valid");
push("semi.line_comment_two_semis",   "SELECT 1; -- ;\n",                 "valid"); // strip leaves "SELECT 1;" -> trimmed "SELECT 1"
push("semi.semi_then_comment_then_kw","SELECT 1 /* ; */; SELECT 2",       { reason: R_MULTI });
push("semi.semi_in_dq_ident_drop",    'SELECT * FROM "DROP;TABLE"',       "valid");
push("semi.three_in_string",          "SELECT 'a;b;c' FROM x",            "valid");
push("semi.unicode_around_semi",      "SELECT 1\u00A0;\u00A0 SELECT 2",   { reason: R_MULTI });
push("semi.multi_with_with",          "WITH x AS (SELECT 1) SELECT * FROM x; SELECT 2", { reason: R_MULTI });

// ---------------------------------------------------------------------------
// Category 9: encoding edge cases (>=20)
// ---------------------------------------------------------------------------
// JS `\s` and `String.prototype.trim()` both treat U+FEFF as whitespace,
// so a BOM at the start is consumed and the lead check matches.
push("enc.bom_lead",                  "\uFEFFSELECT 1",                   "valid");
push("enc.bom_in_string",             "SELECT '\uFEFF' AS x",             "valid");
push("enc.bom_after_select",          "SELECT \uFEFF1",                   "valid");
push("enc.surrogate_pair_string",     "SELECT '\uD83D\uDE00' AS smile",   "valid");
push("enc.lone_high_surrogate",       "SELECT '\uD83D' AS x",             "valid");
push("enc.lone_low_surrogate",        "SELECT '\uDE00' AS x",             "valid");
push("enc.null_byte_in_string",       "SELECT '\u0000' AS x",             "valid");
push("enc.null_byte_lead",            "\u0000SELECT 1",                   { reason: R_NOT_LEAD });
push("enc.null_byte_internal",        "SELECT\u0000 1",                   "valid"); // \b after SELECT requires non-word; null is non-word
push("enc.del_char_string",           "SELECT '\u007F' AS x",             "valid");
push("enc.bell_in_string",            "SELECT '\u0007' AS x",             "valid");
push("enc.escape_char_string",        "SELECT '\u001B' AS x",             "valid");
push("enc.high_codepoint_string",     "SELECT '\u{10FFFF}' AS x",         "valid");
push("enc.replacement_char",          "SELECT '\uFFFD' AS x",             "valid");
push("enc.bom_only",                  "\uFEFF",                           { reason: R_EMPTY });
push("enc.bom_then_ws",               "\uFEFF\n",                         { reason: R_EMPTY });
push("enc.unpaired_surrogates_lots",  "SELECT '" + "\uD83D".repeat(100) + "' AS x", "valid");
push("enc.mixed_surrogates",          "SELECT '\uDE00\uD83D' AS x",       "valid");
push("enc.encoded_html_like_string",  "SELECT '&lt;DROP&gt;' AS x",       "valid");
push("enc.url_encoded_in_string",     "SELECT '%3BDROP%3B' AS x",         "valid");
push("enc.pct_in_query",              "SELECT 1 WHERE x LIKE '%a%'",      "valid");
push("enc.unicode_escape_text",       "SELECT '\\u0041' AS x",            "valid");

// ---------------------------------------------------------------------------
// Category 10: weird numerics (>=20)
// ---------------------------------------------------------------------------
push("num.scientific",                "SELECT 1.5e10",                    "valid");
push("num.scientific_neg_exp",        "SELECT 1.5e-10",                   "valid");
push("num.scientific_caps",           "SELECT 1.5E10",                    "valid");
push("num.hex_lower",                 "SELECT 0x1a",                      "valid");
push("num.hex_upper",                 "SELECT 0X1A",                      "valid");
push("num.bin_literal",               "SELECT 0b1010",                    "valid");
push("num.oct_literal",               "SELECT 0o17",                      "valid");
push("num.float_only",                "SELECT 0.5",                       "valid");
push("num.leading_dot",               "SELECT .5",                        "valid");
push("num.trailing_dot",              "SELECT 5.",                        "valid");
push("num.huge_int",                  "SELECT 99999999999999999999",      "valid");
push("num.negative",                  "SELECT -1",                        "valid");
push("num.double_negative",           "SELECT --1",                       { reason: R_NOT_LEAD }); // -- starts comment? After lead is SELECT, body becomes "SELECT  ". Actually `--1` becomes line comment. After strip: "SELECT" then trimmed -> just "SELECT" lead OK but body is "SELECT" alone -> still valid.
// The line comment regex is `--[^\n\r]*` so `--1` is consumed entirely.
// stripped becomes "SELECT " -> trim -> "SELECT" -> lead matches "SELECT\b" -> matches -> valid.
cases[cases.length - 1].expect = "valid";
push("num.dollar_quoted_postgres",    "SELECT $$abc$$ AS x",              "valid");
push("num.dollar_dollar_with_drop",   "SELECT $$DROP TABLE$$ AS x",       { reason: R_FORBIDDEN }); // $$ not a string literal in our regex; DROP leaks
push("num.dollar_named_quote",        "SELECT $tag$abc$tag$ AS x",        "valid");
push("num.complex_expr",              "SELECT 1 + 2 * 3 / 4 - 5 % 6",     "valid");
push("num.nan_string",                "SELECT 'NaN'::DOUBLE",             "valid");
push("num.inf_string",                "SELECT 'Infinity'::DOUBLE",        "valid");
push("num.cast_chain",                "SELECT 1::BIGINT::VARCHAR",        "valid");
push("num.interval",                  "SELECT INTERVAL '1 day'",          "valid");
push("num.timestamp_literal",         "SELECT TIMESTAMP '2020-01-01'",    "valid");
push("num.date_literal",              "SELECT DATE '2020-01-01'",         "valid");

// ---------------------------------------------------------------------------
// Category 11: DuckDB-specific syntax (>=20)
// ---------------------------------------------------------------------------
push("dd.from_first",                 "FROM x SELECT *",                  { reason: R_NOT_LEAD });
push("dd.from_first_simple",          "FROM matches",                     { reason: R_NOT_LEAD });
push("dd.list_comprehension",         "SELECT [i*2 FOR i IN [1,2,3]]",    "valid");
push("dd.list_literal",               "SELECT [1, 2, 3] AS xs",           "valid");
push("dd.struct_literal",             "SELECT {'a': 1, 'b': 2} AS s",     "valid");
push("dd.struct_dot_access",          "SELECT s.a FROM (SELECT {'a':1} AS s)", "valid");
push("dd.map_literal",                "SELECT MAP([1,2],['a','b'])",      "valid");
push("dd.union_literal",              "SELECT union_value(num := 2)",     "valid");
push("dd.lambda_arrow",               "SELECT list_transform([1,2], x -> x+1)", "valid");
push("dd.star_qualified",             "SELECT t.* FROM t",                "valid");
push("dd.star_exclude",               "SELECT * EXCLUDE (foo) FROM t",    "valid");
// DuckDB's `* REPLACE (...)` projection clause is now allowed; the write
// form `REPLACE INTO ...` is blocked by the dedicated REPLACE_WRITE check.
push("dd.star_replace",               "SELECT * REPLACE (UPPER(name) AS name) FROM t", "valid");
push("dd.columns_pattern",            "SELECT COLUMNS('sales_.*') FROM t", "valid");
push("dd.group_by_all",               "SELECT a, SUM(b) FROM t GROUP BY ALL", "valid");
push("dd.order_by_all",               "SELECT * FROM t ORDER BY ALL",     "valid");
push("dd.union_by_name",              "SELECT * FROM a UNION BY NAME SELECT * FROM b", "valid");
push("dd.qualify_clause",             "SELECT *, ROW_NUMBER() OVER () FROM t QUALIFY ROW_NUMBER() OVER () = 1", "valid");
push("dd.pivot",                      "SELECT * FROM (PIVOT t ON x USING SUM(y))", "valid");
push("dd.unpivot",                    "SELECT * FROM (UNPIVOT t ON a, b INTO NAME k VALUE v)", "valid");
push("dd.read_parquet",               "SELECT * FROM read_parquet('a.parquet')", "valid");
push("dd.read_csv_auto",              "SELECT * FROM read_csv_auto('x.csv')", "valid");
push("dd.summarize",                  "SUMMARIZE SELECT 1",               { reason: R_NOT_LEAD });
push("dd.cte_chain",                  "WITH a AS (SELECT 1), b AS (SELECT 2) SELECT * FROM a, b", "valid");
push("dd.recursive_cte",              "WITH RECURSIVE t(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM t WHERE n<10) SELECT * FROM t", "valid");

// ---------------------------------------------------------------------------
// Category 12: HTTP smuggling / control chars (>=10)
// ---------------------------------------------------------------------------
push("http.crlf_injection",           "SELECT 1\r\nHost: evil.com",       { reason: R_NOT_LEAD }); // body has Host -> not in FORBIDDEN, lead OK -> valid actually
// Lead "SELECT 1\r\nHost: evil.com" -> stripped same -> trimmed same -> lead matches SELECT -> body has no FORBIDDEN, no `;` -> valid
cases[cases.length - 1].expect = "valid";
push("http.crlf_then_select",         "\r\nSELECT 1\r\n\r\nGET /",        "valid");
push("http.host_header",              "Host: evil\r\n\r\nSELECT 1",       { reason: R_NOT_LEAD });
push("http.full_request",             "GET / HTTP/1.1\r\nHost: x\r\n\r\nSELECT 1", { reason: R_NOT_LEAD });
push("http.content_length",           "Content-Length: 0\r\n\r\nSELECT 1", { reason: R_NOT_LEAD });
push("http.te_chunked",               "Transfer-Encoding: chunked\r\n\r\nSELECT 1", { reason: R_NOT_LEAD });
push("http.bell_char",                "SELECT 1\u0007",                   "valid");
push("http.backspace",                "SELECT 1\u0008",                   "valid");
push("http.dle_in_string",            "SELECT '\u0010' AS x",             "valid");
push("http.csi",                      "SELECT '\u009B' AS x",             "valid");
push("http.smuggled_drop",            "SELECT 1\r\nDROP TABLE x",         { reason: R_FORBIDDEN });
push("http.smuggled_semi",            "SELECT 1\r\n; SELECT 2",           { reason: R_MULTI });

// ---------------------------------------------------------------------------
// Category 13: parameter substitution edges (>=20)
// (Mimicking how App.tsx interpolates a state filter into raw SQL.)
// ---------------------------------------------------------------------------
push("param.empty_state",             `SELECT * FROM matches WHERE state = ''`, "valid");
push("param.normal_state",            `SELECT * FROM matches WHERE state = 'AZ'`, "valid");
push("param.state_quote_escaped",     `SELECT * FROM matches WHERE state = 'O''Reilly'`, "valid");
push("param.state_quote_break_out",   `SELECT * FROM matches WHERE state = 'X' OR 1=1 --'`, "valid");
push("param.state_drop_attempt",      `SELECT * FROM matches WHERE state = 'X'; DROP TABLE matches --'`,
                                      { reason: R_FORBIDDEN });
push("param.state_semi_break",        `SELECT * FROM matches WHERE state = 'X'; SELECT 2`,
                                      { reason: R_MULTI });
push("param.state_is_DROP",           `SELECT * FROM matches WHERE state = 'DROP'`, "valid");
push("param.state_is_SELECT",         `SELECT * FROM matches WHERE state = 'SELECT'`, "valid");
push("param.state_is_DELETE",         `SELECT * FROM matches WHERE state = 'DELETE'`, "valid");
push("param.state_is_INSERT",         `SELECT * FROM matches WHERE state = 'INSERT'`, "valid");
push("param.state_is_UPDATE",         `SELECT * FROM matches WHERE state = 'UPDATE'`, "valid");
push("param.state_is_PRAGMA",         `SELECT * FROM matches WHERE state = 'PRAGMA'`, "valid");
push("param.state_quote_escape_DROP", `SELECT * FROM matches WHERE state = 'a''DROP'`, "valid");
push("param.state_long_value",        `SELECT * FROM matches WHERE state = '${"A".repeat(5000)}'`, "valid");
push("param.state_unicode",           `SELECT * FROM matches WHERE state = '🇺🇸'`, "valid");
push("param.in_clause",               `SELECT * FROM matches WHERE state IN ('AZ','TX','CA')`, "valid");
// Tricky: line-comment regex strips `--')` first (eats the closing quote
// the user intended), so the supposedly-quoted `'); DROP TABLE m;` is now
// outside any string. Result is FORBIDDEN — which is the SAFE outcome
// (DuckDB would reject the query anyway, but the validator catches DROP
// regardless).
push("param.in_clause_with_evil",     `SELECT * FROM matches WHERE state IN ('AZ','TX','); DROP TABLE m;--')`,
                                      { reason: R_FORBIDDEN });
push("param.like_pct_drop",           `SELECT * FROM m WHERE x LIKE '%DROP%'`, "valid");
push("param.regexp_drop",             `SELECT * FROM m WHERE x ~ 'DROP'`, "valid");
push("param.json_extract_drop",       `SELECT json_extract(j, '$.DROP') FROM m`, "valid");
push("param.array_drop_string",       `SELECT ['DROP','INSERT'] AS xs`, "valid");
push("param.struct_drop_keys",        `SELECT {'DROP': 1, 'INSERT': 2}`, "valid");

// ---------------------------------------------------------------------------
// Bonus / fill: real-world App.tsx-style queries (push to ~270 total)
// ---------------------------------------------------------------------------
push("real.matches_count",            `SELECT COUNT(*) FROM "shooting"."main"."matches"`, "valid");
push("real.matches_filter_state",     `SELECT * FROM "shooting"."main"."matches" WHERE state = 'AZ'`, "valid");
push("real.recent_window",            `SELECT * FROM "shooting"."main"."matches" WHERE match_date >= CURRENT_DATE - INTERVAL '90 days'`, "valid");
push("real.cte_with_join",            `WITH s AS (SELECT shooter_id FROM "shooting"."main"."shooters") SELECT * FROM s JOIN "shooting"."main"."match_results" mr ON s.shooter_id = mr.shooter_id LIMIT 100`, "valid");
push("real.show_databases",           `SHOW DATABASES`, "valid");
push("real.show_tables",              `SHOW TABLES FROM "shooting"."main"`, "valid");
push("real.describe_table",           `DESCRIBE "shooting"."main"."matches"`, "valid");
push("real.explain_select",           `EXPLAIN SELECT * FROM "shooting"."main"."matches" LIMIT 1`, "valid");
push("real.values_short",             `VALUES (1,'a'), (2,'b')`, "valid");
push("real.with_recursive",           `WITH RECURSIVE t(n) AS (VALUES (1) UNION ALL SELECT n+1 FROM t WHERE n<10) SELECT * FROM t`, "valid");
push("real.inj_attempt_in_string",    `SELECT * FROM matches WHERE name = 'O''Brien; DROP TABLE m;'`, "valid");
push("real.inj_attempt_in_dq",        `SELECT * FROM matches WHERE "weird;col" = 1`, "valid");
push("real.semicolon_only",           ";",                                { reason: R_NOT_LEAD });
push("real.lots_of_semicolons",       ";;;;;",                            { reason: R_NOT_LEAD });
push("real.select_then_blank",        "SELECT 1\n\n",                     "valid");
push("real.huge_in_list",             `SELECT * FROM m WHERE id IN (${Array.from({length: 1000}, (_,i) => i).join(",")})`, "valid");
push("real.with_window",              `SELECT *, ROW_NUMBER() OVER (PARTITION BY a ORDER BY b) FROM t`, "valid");
push("real.upper_select_kw",          "select 1",                         "valid");
push("real.mixed_case_kw",            "SeLeCt 1",                         "valid");
push("real.mixed_case_drop",          "SELECT 1; dRoP TABLE x",           { reason: R_FORBIDDEN });
push("real.kw_in_alias",              `SELECT 1 AS "DROP"`,               "valid");
push("real.kw_in_qualified_table",    `SELECT * FROM "main"."DROP"`,      "valid"); // dq protects DROP
push("real.kw_in_unquoted_alias",     `SELECT 1 AS DROP`,                 { reason: R_FORBIDDEN }); // unquoted DROP -> word boundary -> forbidden
push("real.kw_in_unquoted_alias2",    `SELECT 1 AS dropped_at`,           "valid"); // not a whole word
push("real.alter_substr",             `SELECT 'altered'`,                  "valid"); // string literal protects
push("real.alter_unquoted",           `SELECT * FROM altered_log`,         "valid"); // identifier alter not whole-word; \b matches `altered_log` not? `\baltered_log\b` -> ALTER doesn't match because [a-z_] continues
push("real.create_in_ident",          `SELECT * FROM created_log`,         "valid");
push("real.copy_substr",              `SELECT 'copied' AS x`,              "valid");
push("real.copy_unquoted_kw",         `SELECT 1; COPY x TO 'f.csv'`,       { reason: R_FORBIDDEN });
push("real.attach_attempt",           `ATTACH 'evil.db'`,                  { reason: R_NOT_LEAD });
push("real.pragma_attempt",           `PRAGMA threads=4`,                  { reason: R_NOT_LEAD });
push("real.set_attempt",              `SET memory_limit='1GB'`,            { reason: R_NOT_LEAD });
push("real.use_attempt",              `USE shooting`,                      { reason: R_NOT_LEAD });
push("real.checkpoint_attempt",       `CHECKPOINT`,                        { reason: R_NOT_LEAD });
push("real.install_attempt",          `INSTALL httpfs`,                    { reason: R_NOT_LEAD });
push("real.load_attempt",             `LOAD httpfs`,                       { reason: R_NOT_LEAD });
push("real.with_then_drop",           `WITH x AS (SELECT 1) DELETE FROM y`, { reason: R_FORBIDDEN });
push("real.subselect_drop",           `SELECT (DROP TABLE y) FROM x`,      { reason: R_FORBIDDEN });
push("real.func_call_str",            `SELECT length('DROP TABLE')`,       "valid");
push("real.recursive_with_drop",      `WITH RECURSIVE t AS (DELETE FROM y) SELECT * FROM t`, { reason: R_FORBIDDEN });
push("real.union_select",             `SELECT 1 UNION ALL SELECT 2`,       "valid");
push("real.union_drop",               `SELECT 1 UNION ALL DELETE FROM y`,  { reason: R_FORBIDDEN });
push("real.values_with_dml",          `VALUES (1); DELETE FROM y`,         { reason: R_FORBIDDEN });
push("real.show_with_drop",           `SHOW TABLES; DROP TABLE x`,         { reason: R_FORBIDDEN });
push("real.describe_with_drop",       `DESCRIBE x; DROP TABLE x`,          { reason: R_FORBIDDEN });
push("real.long_valid_aggregate",     `SELECT state, COUNT(*) AS n, MIN(match_date) AS first_seen, MAX(match_date) AS last_seen FROM matches GROUP BY state ORDER BY n DESC LIMIT 100`, "valid");
push("real.shooter_search",           `SELECT * FROM shooter_canonical_summary WHERE shooter_name ILIKE '%tran%' LIMIT 50`, "valid");
push("real.recent_added",             `SELECT * FROM matches WHERE first_seen_at >= NOW() - INTERVAL '7 days' ORDER BY first_seen_at DESC`, "valid");

// ---------------------------------------------------------------------------
// Run cases with timing.
// ---------------------------------------------------------------------------

const SLOW_MS = 100;
const timings = [];

function timedRun(c) {
  const t0 = performance.now();
  let result;
  let threw = null;
  try { result = validateReadOnly(c.sql); }
  catch (e) { threw = e; }
  const t1 = performance.now();
  const ms = t1 - t0;
  timings.push({ name: c.name, ms });
  return { result, threw, ms };
}

const failures = [];
let pass = 0;
let fail = 0;

for (const c of cases) {
  const { result, threw } = timedRun(c);
  if (threw) {
    fail++;
    failures.push({ name: c.name, expected: c.expect, got: `THREW: ${threw.message}` });
    continue;
  }
  let ok;
  if (c.expect === "valid")        ok = result === null;
  else if (c.expect === "invalid") ok = result !== null;
  else if (c.expect && c.expect.reason instanceof RegExp)
                                   ok = result !== null && c.expect.reason.test(result);
  else                             ok = false;
  if (ok) pass++;
  else { fail++; failures.push({ name: c.name, expected: c.expect, got: result }); }
}

// Sanity: also run through runValidatorCases to confirm our wiring matches.
const sanity = runValidatorCases(cases);

const slow = timings.filter(t => t.ms > SLOW_MS).sort((a,b) => b.ms - a.ms);
const top10Slow = [...timings].sort((a,b) => b.ms - a.ms).slice(0, 10);

console.log("===== edge.test.mjs =====");
console.log(`total:  ${cases.length}`);
console.log(`pass:   ${pass}`);
console.log(`fail:   ${fail}`);
console.log(`sanity (runValidatorCases): pass=${sanity.pass} fail=${sanity.fail} total=${sanity.total}`);
console.log(`slow (>${SLOW_MS}ms): ${slow.length}`);

if (slow.length) {
  console.log("\n--- ReDoS suspects (>100ms) ---");
  for (const s of slow.slice(0, 20)) console.log(`  ${s.ms.toFixed(2)}ms  ${s.name}`);
}

console.log("\n--- top 10 slowest (any) ---");
for (const s of top10Slow) console.log(`  ${s.ms.toFixed(3)}ms  ${s.name}`);

if (failures.length) {
  console.log("\n--- first 10 failures ---");
  for (const f of failures.slice(0, 10)) {
    const exp = typeof f.expected === "object" && f.expected?.reason
      ? `reason ~ ${f.expected.reason}`
      : JSON.stringify(f.expected);
    console.log(`  [FAIL] ${f.name}`);
    console.log(`         expected: ${exp}`);
    console.log(`         got:      ${JSON.stringify(f.got)}`);
  }
}

process.exit(failures.length ? 1 : 0);
