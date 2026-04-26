/**
 * Test harness — re-exports the public validator API from dist/ (so tests
 * cover the published artifact, not raw TS source) and provides the
 * `runValidatorCases` / `runJsonCases` helpers the four .test.mjs files
 * use.
 *
 * Per-file expected case totals (any drift here means a real change to the
 * suite, not a bug):
 *   security.test.mjs : 585  (every case must REJECT)
 *   valid.test.mjs    : 374  (every case must PASS)
 *   json.test.mjs     : 303
 *   edge.test.mjs     : 330
 *   ----- TOTAL ----- : 1592
 *
 * Tests run AFTER `npm run build` because they import from dist/.
 */

import {
  validateReadOnly,
  stripCommentsAndLiterals,
  safeStringify,
  jsonReplacer,
} from "../../dist/validator/index.js";

export { validateReadOnly, stripCommentsAndLiterals, safeStringify, jsonReplacer };

export function runValidatorCases(cases) {
  const failures = [];
  let pass = 0;
  for (const c of cases) {
    const result = validateReadOnly(c.sql);
    let ok;
    if (c.expect === "valid") {
      ok = result === null;
    } else if (c.expect === "invalid") {
      ok = result !== null;
    } else if (c.expect && c.expect.reason instanceof RegExp) {
      ok = result !== null && c.expect.reason.test(result);
    } else {
      ok = false;
    }
    if (ok) pass++;
    else failures.push({ name: c.name, sql: c.sql, expected: c.expect, got: result });
  }
  return { pass, fail: failures.length, total: cases.length, failures };
}

export function runJsonCases(cases) {
  const failures = [];
  let pass = 0;
  for (const c of cases) {
    let result;
    try {
      result = safeStringify(c.value);
    } catch (e) {
      result = `THREW: ${e.message}`;
    }
    const ok = result === c.expectJson;
    if (ok) pass++;
    else failures.push({ name: c.name, expected: c.expectJson, got: result });
  }
  return { pass, fail: failures.length, total: cases.length, failures };
}
