// Tests for safeStringify / jsonReplacer in validator.mjs.
//
// Contract being tested:
//   - BigInt within [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]
//     -> serialized as a plain JSON number
//   - BigInt outside that range -> serialized as a JSON string (precision-preserving)
//   - Non-BigInt values pass through to JSON.stringify unchanged
//   - Never throws on normal inputs (circular refs throw natively, expected)
//
// Run: node tests/proxy/json.test.mjs

import { safeStringify, runJsonCases } from "../helpers/validator-harness.mjs";

const cases = [];

// ---------------------------------------------------------------------------
// 1. In-range BigInts -> number (>=40 cases)
// ---------------------------------------------------------------------------
cases.push({ name: "bigint 0n", value: 0n, expectJson: "0" });
cases.push({ name: "bigint 1n", value: 1n, expectJson: "1" });
cases.push({ name: "bigint 42n", value: 42n, expectJson: "42" });
cases.push({ name: "bigint -1n", value: -1n, expectJson: "-1" });
cases.push({ name: "bigint -42n", value: -42n, expectJson: "-42" });
cases.push({ name: "bigint MAX_SAFE", value: BigInt(Number.MAX_SAFE_INTEGER), expectJson: "9007199254740991" });
cases.push({ name: "bigint MIN_SAFE", value: BigInt(Number.MIN_SAFE_INTEGER), expectJson: "-9007199254740991" });
cases.push({ name: "bigint 100n", value: 100n, expectJson: "100" });
cases.push({ name: "bigint 1000n", value: 1000n, expectJson: "1000" });
cases.push({ name: "bigint 1000000n", value: 1000000n, expectJson: "1000000" });
cases.push({ name: "bigint 1234567890n", value: 1234567890n, expectJson: "1234567890" });
cases.push({ name: "bigint -100n", value: -100n, expectJson: "-100" });
cases.push({ name: "bigint -1000000n", value: -1000000n, expectJson: "-1000000" });
// 1n through 30n
for (let i = 1n; i <= 30n; i++) {
  cases.push({ name: `bigint ${i}n positive small`, value: i, expectJson: i.toString() });
}
// negative equivalents
for (let i = 1n; i <= 30n; i++) {
  cases.push({ name: `bigint -${i}n negative small`, value: -i, expectJson: (-i).toString() });
}
// Some realistic in-range INT8 ids (PractiScore numeric ids fit easily)
cases.push({ name: "bigint 250000n", value: 250000n, expectJson: "250000" });
cases.push({ name: "bigint 8888888n", value: 8888888n, expectJson: "8888888" });
cases.push({ name: "bigint 9007199254740990n (MAX_SAFE-1)", value: 9007199254740990n, expectJson: "9007199254740990" });
cases.push({ name: "bigint -9007199254740990n (MIN_SAFE+1)", value: -9007199254740990n, expectJson: "-9007199254740990" });

// ---------------------------------------------------------------------------
// 2. Out-of-range BigInts -> string (>=20 cases)
// ---------------------------------------------------------------------------
cases.push({ name: "bigint MAX_SAFE+1", value: 9007199254740992n, expectJson: '"9007199254740992"' });
cases.push({ name: "bigint MAX_SAFE+2", value: 9007199254740993n, expectJson: '"9007199254740993"' });
cases.push({ name: "bigint MAX_SAFE+1000", value: 9007199254741991n, expectJson: '"9007199254741991"' });
cases.push({ name: "bigint MIN_SAFE-1", value: -9007199254740992n, expectJson: '"-9007199254740992"' });
cases.push({ name: "bigint MIN_SAFE-2", value: -9007199254740993n, expectJson: '"-9007199254740993"' });
cases.push({ name: "bigint 10000000000000000n", value: 10000000000000000n, expectJson: '"10000000000000000"' });
cases.push({ name: "bigint -10000000000000000n", value: -10000000000000000n, expectJson: '"-10000000000000000"' });
cases.push({ name: "bigint 99999999999999999n", value: 99999999999999999n, expectJson: '"99999999999999999"' });
cases.push({ name: "bigint 9999999999999999999n", value: 9999999999999999999n, expectJson: '"9999999999999999999"' });
cases.push({ name: "bigint -9999999999999999999n", value: -9999999999999999999n, expectJson: '"-9999999999999999999"' });
cases.push({ name: "bigint Postgres BIGINT max", value: 9223372036854775807n, expectJson: '"9223372036854775807"' });
cases.push({ name: "bigint Postgres BIGINT min", value: -9223372036854775808n, expectJson: '"-9223372036854775808"' });
cases.push({ name: "bigint very huge 1e25", value: 10000000000000000000000000n, expectJson: '"10000000000000000000000000"' });
cases.push({ name: "bigint very huge -1e25", value: -10000000000000000000000000n, expectJson: '"-10000000000000000000000000"' });
cases.push({ name: "bigint just over MAX_SAFE 1", value: 9007199254740992n, expectJson: '"9007199254740992"' });
cases.push({ name: "bigint just under MIN_SAFE 1", value: -9007199254740992n, expectJson: '"-9007199254740992"' });
cases.push({ name: "bigint pg seq fictional 1", value: 12345678901234567n, expectJson: '"12345678901234567"' });
cases.push({ name: "bigint pg seq fictional 2", value: 98765432109876543n, expectJson: '"98765432109876543"' });
cases.push({ name: "bigint pg seq fictional 3", value: -12345678901234567n, expectJson: '"-12345678901234567"' });
cases.push({ name: "bigint pg seq fictional 4", value: 11111111111111111n, expectJson: '"11111111111111111"' });
cases.push({ name: "bigint pg seq fictional 5", value: 22222222222222222n, expectJson: '"22222222222222222"' });

// ---------------------------------------------------------------------------
// 3. Boundary BigInts (>=10 cases)
// ---------------------------------------------------------------------------
cases.push({ name: "boundary exactly MAX_SAFE", value: 9007199254740991n, expectJson: "9007199254740991" });
cases.push({ name: "boundary MAX_SAFE-1", value: 9007199254740990n, expectJson: "9007199254740990" });
cases.push({ name: "boundary MAX_SAFE+1", value: 9007199254740992n, expectJson: '"9007199254740992"' });
cases.push({ name: "boundary exactly MIN_SAFE", value: -9007199254740991n, expectJson: "-9007199254740991" });
cases.push({ name: "boundary MIN_SAFE+1", value: -9007199254740990n, expectJson: "-9007199254740990" });
cases.push({ name: "boundary MIN_SAFE-1", value: -9007199254740992n, expectJson: '"-9007199254740992"' });
cases.push({ name: "boundary BigInt(MAX_SAFE) equal", value: BigInt(Number.MAX_SAFE_INTEGER), expectJson: "9007199254740991" });
cases.push({ name: "boundary BigInt(MIN_SAFE) equal", value: BigInt(Number.MIN_SAFE_INTEGER), expectJson: "-9007199254740991" });
cases.push({ name: "boundary BigInt(MAX_SAFE)+1n", value: BigInt(Number.MAX_SAFE_INTEGER) + 1n, expectJson: '"9007199254740992"' });
cases.push({ name: "boundary BigInt(MIN_SAFE)-1n", value: BigInt(Number.MIN_SAFE_INTEGER) - 1n, expectJson: '"-9007199254740992"' });
cases.push({ name: "boundary BigInt(MAX_SAFE)-1n", value: BigInt(Number.MAX_SAFE_INTEGER) - 1n, expectJson: "9007199254740990" });
cases.push({ name: "boundary BigInt(MIN_SAFE)+1n", value: BigInt(Number.MIN_SAFE_INTEGER) + 1n, expectJson: "-9007199254740990" });

// ---------------------------------------------------------------------------
// 4. Plain numbers (no conversion needed) (>=30 cases)
//    For NaN / Infinity, JSON.stringify yields "null" (top-level returns
//    undefined => safeStringify returns the string "undefined" actually
//    JSON.stringify(NaN) returns "null"; JSON.stringify(Infinity) returns "null").
// ---------------------------------------------------------------------------
cases.push({ name: "number 0", value: 0, expectJson: "0" });
cases.push({ name: "number 1", value: 1, expectJson: "1" });
cases.push({ name: "number -1", value: -1, expectJson: "-1" });
cases.push({ name: "number 3.14", value: 3.14, expectJson: "3.14" });
cases.push({ name: "number 1.5", value: 1.5, expectJson: "1.5" });
cases.push({ name: "number -3.14", value: -3.14, expectJson: "-3.14" });
cases.push({ name: "number 1e10", value: 1e10, expectJson: "10000000000" });
cases.push({ name: "number 1e-10", value: 1e-10, expectJson: "1e-10" });
cases.push({ name: "number Number.MAX_SAFE_INTEGER", value: Number.MAX_SAFE_INTEGER, expectJson: "9007199254740991" });
cases.push({ name: "number Number.MIN_SAFE_INTEGER", value: Number.MIN_SAFE_INTEGER, expectJson: "-9007199254740991" });
cases.push({ name: "number Number.MAX_VALUE", value: Number.MAX_VALUE, expectJson: JSON.stringify(Number.MAX_VALUE) });
cases.push({ name: "number Number.MIN_VALUE", value: Number.MIN_VALUE, expectJson: JSON.stringify(Number.MIN_VALUE) });
cases.push({ name: "number Number.EPSILON", value: Number.EPSILON, expectJson: JSON.stringify(Number.EPSILON) });
cases.push({ name: "number 0.1", value: 0.1, expectJson: "0.1" });
cases.push({ name: "number 0.2", value: 0.2, expectJson: "0.2" });
cases.push({ name: "number 0.1+0.2", value: 0.1 + 0.2, expectJson: JSON.stringify(0.1 + 0.2) });
cases.push({ name: "number negative zero", value: -0, expectJson: "0" });
cases.push({ name: "number 100", value: 100, expectJson: "100" });
cases.push({ name: "number 1000000", value: 1000000, expectJson: "1000000" });
cases.push({ name: "number -1000000", value: -1000000, expectJson: "-1000000" });
// NaN/Infinity at top level: JSON.stringify(NaN) === "null"
cases.push({ name: "number NaN top-level", value: NaN, expectJson: "null" });
cases.push({ name: "number Infinity top-level", value: Infinity, expectJson: "null" });
cases.push({ name: "number -Infinity top-level", value: -Infinity, expectJson: "null" });
cases.push({ name: "number NaN in object", value: { n: NaN }, expectJson: '{"n":null}' });
cases.push({ name: "number Infinity in object", value: { n: Infinity }, expectJson: '{"n":null}' });
cases.push({ name: "number -Infinity in object", value: { n: -Infinity }, expectJson: '{"n":null}' });
cases.push({ name: "number NaN in array", value: [NaN], expectJson: "[null]" });
cases.push({ name: "number Infinity in array", value: [Infinity], expectJson: "[null]" });
cases.push({ name: "number 42.5 in object", value: { x: 42.5 }, expectJson: '{"x":42.5}' });
cases.push({ name: "number small float -0.0001", value: -0.0001, expectJson: "-0.0001" });
cases.push({ name: "number large float 1234567.89", value: 1234567.89, expectJson: "1234567.89" });
cases.push({ name: "number scientific notation 2.5e8", value: 2.5e8, expectJson: "250000000" });
cases.push({ name: "number small scientific 1e-7", value: 1e-7, expectJson: "1e-7" });

// ---------------------------------------------------------------------------
// 5. Strings, booleans, null, undefined (>=30 cases)
// ---------------------------------------------------------------------------
cases.push({ name: "string hello", value: "hello", expectJson: '"hello"' });
cases.push({ name: "string empty", value: "", expectJson: '""' });
cases.push({ name: "string with quote", value: 'he said "hi"', expectJson: '"he said \\"hi\\""' });
cases.push({ name: "string with backslash", value: "a\\b", expectJson: '"a\\\\b"' });
cases.push({ name: "string with newline", value: "line1\nline2", expectJson: '"line1\\nline2"' });
cases.push({ name: "string with tab", value: "col1\tcol2", expectJson: '"col1\\tcol2"' });
cases.push({ name: "string with carriage return", value: "a\rb", expectJson: '"a\\rb"' });
cases.push({ name: "string emoji rocket", value: "rocket: 🚀", expectJson: JSON.stringify("rocket: 🚀") });
cases.push({ name: "string emoji multiple", value: "👍🎉🔥", expectJson: JSON.stringify("👍🎉🔥") });
cases.push({ name: "string Chinese", value: "你好世界", expectJson: JSON.stringify("你好世界") });
cases.push({ name: "string Japanese", value: "こんにちは", expectJson: JSON.stringify("こんにちは") });
cases.push({ name: "string Arabic RTL", value: "مرحبا", expectJson: JSON.stringify("مرحبا") });
cases.push({ name: "string Hebrew RTL", value: "שלום", expectJson: JSON.stringify("שלום") });
cases.push({ name: "string Cyrillic", value: "Привет", expectJson: JSON.stringify("Привет") });
cases.push({ name: "string mixed scripts", value: "Hello 世界 🌍 مرحبا", expectJson: JSON.stringify("Hello 世界 🌍 مرحبا") });
cases.push({ name: "string with null char", value: "a\u0000b", expectJson: '"a\\u0000b"' });
cases.push({ name: "string with unicode escape", value: "\u00e9", expectJson: '"é"' });
cases.push({ name: "boolean true", value: true, expectJson: "true" });
cases.push({ name: "boolean false", value: false, expectJson: "false" });
cases.push({ name: "null literal", value: null, expectJson: "null" });
cases.push({ name: "undefined top-level", value: undefined, expectJson: undefined }); // JSON.stringify(undefined) === undefined
cases.push({ name: "undefined in object", value: { x: undefined }, expectJson: "{}" });
cases.push({ name: "undefined in array", value: [undefined], expectJson: "[null]" });
cases.push({ name: "undefined in array among values", value: [1, undefined, 3], expectJson: "[1,null,3]" });
cases.push({ name: "object with null field", value: { a: null }, expectJson: '{"a":null}' });
cases.push({ name: "object with empty string", value: { name: "" }, expectJson: '{"name":""}' });
cases.push({ name: "object with bool true", value: { ok: true }, expectJson: '{"ok":true}' });
cases.push({ name: "object with bool false", value: { ok: false }, expectJson: '{"ok":false}' });
cases.push({ name: "string slash forward", value: "a/b", expectJson: '"a/b"' });
cases.push({ name: "string only spaces", value: "   ", expectJson: '"   "' });

// ---------------------------------------------------------------------------
// 6. Arrays of mixed values (>=20 cases)
// ---------------------------------------------------------------------------
cases.push({ name: "array [1n, 2n, 3n]", value: [1n, 2n, 3n], expectJson: "[1,2,3]" });
cases.push({ name: "array [42n, string, true, null]", value: [42n, "string", true, null], expectJson: '[42,"string",true,null]' });
cases.push({ name: "array [huge bigint, 0]", value: [9999999999999999999n, 0], expectJson: '["9999999999999999999",0]' });
cases.push({ name: "nested array [[1n,2n],[3n,4n]]", value: [[1n, 2n], [3n, 4n]], expectJson: "[[1,2],[3,4]]" });
cases.push({ name: "empty array", value: [], expectJson: "[]" });
cases.push({ name: "array of strings", value: ["a", "b", "c"], expectJson: '["a","b","c"]' });
cases.push({ name: "array of booleans", value: [true, false, true], expectJson: "[true,false,true]" });
cases.push({ name: "array of nulls", value: [null, null], expectJson: "[null,null]" });
cases.push({ name: "array of bigints all in-range", value: [10n, 20n, 30n, 40n], expectJson: "[10,20,30,40]" });
cases.push({ name: "array of bigints all out-of-range", value: [9007199254740992n, 9007199254740993n], expectJson: '["9007199254740992","9007199254740993"]' });
cases.push({ name: "array mixed in/out range bigints", value: [1n, 9007199254740992n, 2n], expectJson: '[1,"9007199254740992",2]' });
cases.push({ name: "array deeply nested 3 levels", value: [[[1n]]], expectJson: "[[[1]]]" });
cases.push({ name: "array with null and bigint", value: [null, 5n], expectJson: "[null,5]" });
cases.push({ name: "array with object containing bigint", value: [{ id: 7n }], expectJson: '[{"id":7}]' });
cases.push({ name: "array with multiple objects", value: [{ id: 1n }, { id: 2n }], expectJson: '[{"id":1},{"id":2}]' });
cases.push({ name: "array of pg-shaped rows", value: [{ id: 100n, name: "x" }, { id: 200n, name: "y" }], expectJson: '[{"id":100,"name":"x"},{"id":200,"name":"y"}]' });
cases.push({ name: "array length 1 single bigint", value: [42n], expectJson: "[42]" });
cases.push({ name: "array undefined element", value: [undefined], expectJson: "[null]" });
cases.push({ name: "array with NaN element", value: [NaN], expectJson: "[null]" });
cases.push({ name: "array with mixed primitives and bigint", value: [1, "two", 3n, true, null], expectJson: '[1,"two",3,true,null]' });
cases.push({ name: "array bigint mixed signs", value: [-5n, 0n, 5n], expectJson: "[-5,0,5]" });
cases.push({ name: "array nested out-of-range bigint", value: [[[10000000000000000n]]], expectJson: '[[["10000000000000000"]]]' });

// ---------------------------------------------------------------------------
// 7. Objects with mixed bigints (>=30 cases)
// ---------------------------------------------------------------------------
cases.push({ name: "obj {id:42n}", value: { id: 42n }, expectJson: '{"id":42}' });
cases.push({ name: "obj {id:42n,count:9999n,name:x}", value: { id: 42n, count: 9999n, name: "x" }, expectJson: '{"id":42,"count":9999,"name":"x"}' });
cases.push({ name: "obj nested {a:{b:{c:1n}}}", value: { a: { b: { c: 1n } } }, expectJson: '{"a":{"b":{"c":1}}}' });
cases.push({ name: "obj empty", value: {}, expectJson: "{}" });
cases.push({ name: "obj single string field", value: { name: "test" }, expectJson: '{"name":"test"}' });
cases.push({ name: "obj id huge bigint", value: { id: 9999999999999999999n }, expectJson: '{"id":"9999999999999999999"}' });
cases.push({ name: "obj mixed in/out range fields", value: { small: 5n, big: 9999999999999999999n }, expectJson: '{"small":5,"big":"9999999999999999999"}' });
cases.push({ name: "obj with array of bigints", value: { ids: [1n, 2n, 3n] }, expectJson: '{"ids":[1,2,3]}' });
cases.push({ name: "obj with array of huge bigints", value: { ids: [9999999999999999999n] }, expectJson: '{"ids":["9999999999999999999"]}' });
cases.push({ name: "obj typical pg row count", value: { count: 1234n }, expectJson: '{"count":1234}' });
cases.push({ name: "obj typical pg row null", value: { id: 1n, name: null }, expectJson: '{"id":1,"name":null}' });
cases.push({ name: "obj match-shaped", value: { match_uuid: "abc-def", num_shooters: 50n, num_stages: 6n }, expectJson: '{"match_uuid":"abc-def","num_shooters":50,"num_stages":6}' });
cases.push({ name: "obj deeply nested 4 levels", value: { l1: { l2: { l3: { l4: 1n } } } }, expectJson: '{"l1":{"l2":{"l3":{"l4":1}}}}' });
cases.push({ name: "obj with multiple field types", value: { id: 1n, name: "x", active: true, score: 3.14, parent: null }, expectJson: '{"id":1,"name":"x","active":true,"score":3.14,"parent":null}' });
cases.push({ name: "obj with array mixed ranges", value: { items: [1n, 9007199254740992n, 2n] }, expectJson: '{"items":[1,"9007199254740992",2]}' });
cases.push({ name: "obj nested object with bigint", value: { meta: { count: 1000n } }, expectJson: '{"meta":{"count":1000}}' });
cases.push({ name: "obj with undefined field skipped", value: { a: 1n, b: undefined }, expectJson: '{"a":1}' });
cases.push({ name: "obj with NaN field nulled", value: { score: NaN }, expectJson: '{"score":null}' });
cases.push({ name: "obj with Infinity field nulled", value: { ratio: Infinity }, expectJson: '{"ratio":null}' });
cases.push({ name: "obj typical AZ match row", value: { match_uuid: "uuid-1", state: "AZ", num_shooters: 75n }, expectJson: '{"match_uuid":"uuid-1","state":"AZ","num_shooters":75}' });
cases.push({ name: "obj count field as bigint zero", value: { count: 0n }, expectJson: '{"count":0}' });
cases.push({ name: "obj negative bigint field", value: { delta: -1n }, expectJson: '{"delta":-1}' });
cases.push({ name: "obj field with huge negative bigint", value: { offset: -9999999999999999999n }, expectJson: '{"offset":"-9999999999999999999"}' });
cases.push({ name: "obj two huge bigints", value: { a: 99999999999999999n, b: 88888888888888888n }, expectJson: '{"a":"99999999999999999","b":"88888888888888888"}' });
cases.push({ name: "obj with empty array", value: { items: [] }, expectJson: '{"items":[]}' });
cases.push({ name: "obj with empty object field", value: { meta: {} }, expectJson: '{"meta":{}}' });
cases.push({ name: "obj keys with special chars", value: { "a-b": 1n, "c.d": 2n }, expectJson: '{"a-b":1,"c.d":2}' });
cases.push({ name: "obj key with quote", value: { 'a"b': 1n }, expectJson: '{"a\\"b":1}' });
cases.push({ name: "obj key with newline", value: { "a\nb": 1n }, expectJson: '{"a\\nb":1}' });
cases.push({ name: "obj many fields", value: { a: 1n, b: 2n, c: 3n, d: 4n, e: 5n }, expectJson: '{"a":1,"b":2,"c":3,"d":4,"e":5}' });
cases.push({ name: "obj nested arrays of objects", value: { rows: [{ id: 1n }, { id: 2n }] }, expectJson: '{"rows":[{"id":1},{"id":2}]}' });

// ---------------------------------------------------------------------------
// 8. Date objects (>=10 cases)
// ---------------------------------------------------------------------------
const date_epoch = new Date(0);
const date_2026 = new Date(Date.UTC(2026, 3, 25, 12, 0, 0));
const date_y2k = new Date(Date.UTC(2000, 0, 1));
cases.push({ name: "date epoch", value: date_epoch, expectJson: JSON.stringify(date_epoch) });
cases.push({ name: "date 2026-04-25", value: date_2026, expectJson: JSON.stringify(date_2026) });
cases.push({ name: "date Y2K", value: date_y2k, expectJson: JSON.stringify(date_y2k) });
cases.push({ name: "obj with date field", value: { ts: date_epoch }, expectJson: JSON.stringify({ ts: date_epoch }) });
cases.push({ name: "obj with date field 2026", value: { ts: date_2026 }, expectJson: JSON.stringify({ ts: date_2026 }) });
cases.push({ name: "array with date", value: [date_epoch], expectJson: JSON.stringify([date_epoch]) });
cases.push({ name: "obj date + bigint", value: { ts: date_epoch, count: 5n }, expectJson: JSON.stringify({ ts: date_epoch }).replace(/}$/, ',"count":5}') });
cases.push({ name: "date pre-1970", value: new Date(Date.UTC(1969, 0, 1)), expectJson: JSON.stringify(new Date(Date.UTC(1969, 0, 1))) });
cases.push({ name: "date far future", value: new Date(Date.UTC(2099, 11, 31)), expectJson: JSON.stringify(new Date(Date.UTC(2099, 11, 31))) });
cases.push({ name: "obj with timestamp field name", value: { timestamp_utc: date_2026, name: "match" }, expectJson: JSON.stringify({ timestamp_utc: date_2026, name: "match" }) });
cases.push({ name: "array of dates", value: [date_epoch, date_y2k, date_2026], expectJson: JSON.stringify([date_epoch, date_y2k, date_2026]) });

// ---------------------------------------------------------------------------
// 9. Buffer / typed-array-like (>=10 cases)
//    JSON.stringify(Uint8Array) -> serializes as object with numeric keys
//    e.g. {"0":1,"1":2}. We just preserve native behavior.
// ---------------------------------------------------------------------------
const u8 = new Uint8Array([1, 2, 3]);
const u8_empty = new Uint8Array([]);
const u16 = new Uint16Array([100, 200]);
const i32 = new Int32Array([-1, 0, 1]);
const f32 = new Float32Array([1.5, 2.5]);
const f64 = new Float64Array([3.14]);
cases.push({ name: "Uint8Array [1,2,3]", value: u8, expectJson: JSON.stringify(u8) });
cases.push({ name: "Uint8Array empty", value: u8_empty, expectJson: JSON.stringify(u8_empty) });
cases.push({ name: "Uint16Array", value: u16, expectJson: JSON.stringify(u16) });
cases.push({ name: "Int32Array", value: i32, expectJson: JSON.stringify(i32) });
cases.push({ name: "Float32Array", value: f32, expectJson: JSON.stringify(f32) });
cases.push({ name: "Float64Array", value: f64, expectJson: JSON.stringify(f64) });
cases.push({ name: "obj with typed array field", value: { bytes: u8 }, expectJson: JSON.stringify({ bytes: u8 }) });
cases.push({ name: "array containing typed array", value: [u8], expectJson: JSON.stringify([u8]) });
cases.push({ name: "Uint8Array length 1", value: new Uint8Array([42]), expectJson: JSON.stringify(new Uint8Array([42])) });
cases.push({ name: "Uint8Array length 5", value: new Uint8Array([1, 2, 3, 4, 5]), expectJson: JSON.stringify(new Uint8Array([1, 2, 3, 4, 5])) });
cases.push({ name: "Buffer-like via ArrayBuffer view", value: new Uint8Array([255, 0, 127]), expectJson: JSON.stringify(new Uint8Array([255, 0, 127])) });

// ---------------------------------------------------------------------------
// 10. Adversarial (>=30 cases)
// ---------------------------------------------------------------------------
// Circular reference: must throw -> safeStringify catches via runJsonCases.
// Node embeds a verbose error message that includes the property path; we
// compute the expected string from the actual call once so the assertion
// matches whichever Node version is running.
function expectedThrowFor(v) {
  try { JSON.stringify(v, (_k, x) => typeof x === "bigint" ? Number(x) : x); return null; }
  catch (e) { return `THREW: ${e.message}`; }
}
const circ = {};
circ.self = circ;
cases.push({ name: "adv circular self-ref", value: circ, expectJson: expectedThrowFor(circ) });
const circ2 = { a: { b: {} } };
circ2.a.b.parent = circ2;
cases.push({ name: "adv circular nested", value: circ2, expectJson: expectedThrowFor(circ2) });
const circArr = [];
circArr.push(circArr);
cases.push({ name: "adv circular array self", value: circArr, expectJson: expectedThrowFor(circArr) });

// Symbol keys ignored by JSON.stringify
cases.push({ name: "adv symbol keys ignored", value: { [Symbol("s")]: 1n, regular: 2n }, expectJson: '{"regular":2}' });
cases.push({ name: "adv symbol-only keys", value: { [Symbol("a")]: 1, [Symbol("b")]: 2 }, expectJson: "{}" });

// Symbol value ignored in object, becomes null in array
cases.push({ name: "adv symbol value in obj", value: { x: Symbol("y") }, expectJson: "{}" });
cases.push({ name: "adv symbol value in array", value: [Symbol("y")], expectJson: "[null]" });

// Functions ignored in object, null in array
cases.push({ name: "adv function in obj", value: { fn: () => 1 }, expectJson: "{}" });
cases.push({ name: "adv function in array", value: [() => 1], expectJson: "[null]" });

// Getter that throws -> safeStringify will throw
const throwerObj = {};
Object.defineProperty(throwerObj, "bad", {
  get() { throw new Error("getter blew up"); },
  enumerable: true,
});
cases.push({ name: "adv getter throws", value: throwerObj, expectJson: "THREW: getter blew up" });

// Object with toJSON returning a value
cases.push({ name: "adv toJSON returns string", value: { toJSON: () => "stringified" }, expectJson: '"stringified"' });
cases.push({ name: "adv toJSON returns object with bigint", value: { toJSON: () => ({ id: 5n }) }, expectJson: '{"id":5}' });
cases.push({ name: "adv toJSON returns out-of-range bigint", value: { toJSON: () => 9999999999999999999n }, expectJson: '"9999999999999999999"' });
cases.push({ name: "adv toJSON returns in-range bigint", value: { toJSON: () => 5n }, expectJson: "5" });

// Prototype-polluted object -- only own enumerable props are serialized
function Polluted() { this.own = 1n; }
Polluted.prototype.inherited = 2n;
cases.push({ name: "adv prototype-polluted only own props", value: new Polluted(), expectJson: '{"own":1}' });

// Object.create(null) - no prototype
const noProto = Object.create(null);
noProto.id = 7n;
cases.push({ name: "adv null-prototype obj", value: noProto, expectJson: '{"id":7}' });

// Date subclass behaves like Date
class DateSub extends Date {}
const ds = new DateSub(0);
cases.push({ name: "adv Date subclass", value: ds, expectJson: JSON.stringify(ds) });

// Class instance
class Row { constructor(id) { this.id = id; this.name = "x"; } }
cases.push({ name: "adv class instance", value: new Row(42n), expectJson: '{"id":42,"name":"x"}' });

// Object with non-enumerable property (skipped)
const nonEnum = {};
Object.defineProperty(nonEnum, "hidden", { value: 1n, enumerable: false });
nonEnum.shown = 2n;
cases.push({ name: "adv non-enumerable skipped", value: nonEnum, expectJson: '{"shown":2}' });

// Map and Set serialize as empty objects (no enumerable own props)
cases.push({ name: "adv Map serialized as {}", value: new Map([["a", 1n]]), expectJson: "{}" });
cases.push({ name: "adv Set serialized as {}", value: new Set([1n, 2n, 3n]), expectJson: "{}" });

// Deeply nested object (depth 100) - should not throw
function makeDeep(n) {
  let o = { v: 1n };
  for (let i = 0; i < n; i++) o = { child: o };
  return o;
}
const deep100 = makeDeep(100);
const deep100Expected = JSON.stringify(deep100, (_k, v) => {
  if (typeof v !== "bigint") return v;
  return Number(v);
});
cases.push({ name: "adv deep 100 levels nested", value: deep100, expectJson: deep100Expected });

// Wide object (1000 keys)
const wide = {};
for (let i = 0; i < 1000; i++) wide["k" + i] = BigInt(i);
const wideExpected = JSON.stringify(wide, (_k, v) => {
  if (typeof v !== "bigint") return v;
  return Number(v);
});
cases.push({ name: "adv wide obj 1000 keys", value: wide, expectJson: wideExpected });

// Array of 10000 bigints - perf check, just confirm no throw and correct
const big_arr = new Array(10000);
for (let i = 0; i < 10000; i++) big_arr[i] = BigInt(i);
const big_arr_expected = "[" + big_arr.map((b) => b.toString()).join(",") + "]";
cases.push({ name: "adv array 10000 bigints", value: big_arr, expectJson: big_arr_expected });

// Array of 1000 huge bigints (out-of-range)
const big_huge = new Array(1000);
for (let i = 0; i < 1000; i++) big_huge[i] = 9999999999999999999n + BigInt(i);
const big_huge_expected = "[" + big_huge.map((b) => `"${b.toString()}"`).join(",") + "]";
cases.push({ name: "adv array 1000 huge bigints", value: big_huge, expectJson: big_huge_expected });

// Sparse array
// eslint-disable-next-line no-sparse-arrays
const sparse = [1n, , 3n];
cases.push({ name: "adv sparse array", value: sparse, expectJson: "[1,null,3]" });

// Object with negative bigint zero (-0n is invalid; bigint has no -0)
cases.push({ name: "adv bigint -0n is just 0n", value: -0n, expectJson: "0" });

// Boolean object wrapper
// eslint-disable-next-line no-new-wrappers
cases.push({ name: "adv Boolean wrapper", value: new Boolean(true), expectJson: "true" });
// eslint-disable-next-line no-new-wrappers
cases.push({ name: "adv Number wrapper", value: new Number(42), expectJson: "42" });
// eslint-disable-next-line no-new-wrappers
cases.push({ name: "adv String wrapper", value: new String("x"), expectJson: '"x"' });

// RegExp serializes to {} natively
cases.push({ name: "adv RegExp", value: /abc/g, expectJson: "{}" });

// Object with __proto__ as own property (set with defineProperty, not assignment)
const protoOwn = {};
Object.defineProperty(protoOwn, "__proto__", { value: 5n, enumerable: true, writable: true, configurable: true });
cases.push({ name: "adv __proto__ as own enumerable prop", value: protoOwn, expectJson: '{"__proto__":5}' });

// ---------------------------------------------------------------------------
// 11. Realistic dashboard payload shapes (>=20 cases)
// ---------------------------------------------------------------------------

// AZ matches list - typical row from `matches` table
const matches_row_1 = {
  match_uuid: "abc123-def456",
  match_name: "Cowtown USPSA Monday Night",
  match_date: "2026-04-21",
  state: "AZ",
  num_shooters: 75n,
  num_stages: 6n,
  match_type: "uspsa_p",
  club: "Cowtown Pistol Club",
  scraped_at: new Date(Date.UTC(2026, 3, 22, 0, 0, 0)),
  first_seen_at: new Date(Date.UTC(2026, 3, 22, 0, 0, 0)),
};
cases.push({ name: "payload AZ match row", value: matches_row_1, expectJson: JSON.stringify(matches_row_1, (_k, v) => typeof v === "bigint" ? Number(v) : v) });

const matches_row_2 = {
  match_uuid: "uuid-2",
  match_name: "Phoenix Rod & Gun",
  state: "AZ",
  num_shooters: 0n,
  num_stages: 0n,
  match_type: null,
  club: null,
};
cases.push({ name: "payload match with nulls", value: matches_row_2, expectJson: '{"match_uuid":"uuid-2","match_name":"Phoenix Rod & Gun","state":"AZ","num_shooters":0,"num_stages":0,"match_type":null,"club":null}' });

// Array of match rows (typical dashboard query result)
const match_array = [
  { id: 100n, name: "match A", count: 50n },
  { id: 101n, name: "match B", count: 60n },
  { id: 102n, name: "match C", count: 0n },
];
cases.push({ name: "payload array of 3 match rows", value: match_array, expectJson: '[{"id":100,"name":"match A","count":50},{"id":101,"name":"match B","count":60},{"id":102,"name":"match C","count":0}]' });

// Match with shooter results (nested)
const match_with_results = {
  match_uuid: "u1",
  results: [
    { shooter_id: "mmShooter_111", place: 1n, hit_factor: 6.5 },
    { shooter_id: "mmShooter_222", place: 2n, hit_factor: 5.8 },
  ],
};
cases.push({ name: "payload match with nested results", value: match_with_results, expectJson: '{"match_uuid":"u1","results":[{"shooter_id":"mmShooter_111","place":1,"hit_factor":6.5},{"shooter_id":"mmShooter_222","place":2,"hit_factor":5.8}]}' });

// Shooter profile shape
const profile = {
  canonical_id: "michael-758",
  display_name: "Michael Garber",
  member_number: "A138127",
  total_matches: 16n,
  best_finish: 1n,
  avg_match_pct: 78.5,
};
cases.push({ name: "payload shooter profile", value: profile, expectJson: JSON.stringify(profile, (_k, v) => typeof v === "bigint" ? Number(v) : v) });

// Stage results
const stage_results = [
  { match_uuid: "u1", stage_num: 1n, shooter_id: "s1", a_hits: 10n, c_hits: 2n, d_hits: 0n, mikes: 0n },
  { match_uuid: "u1", stage_num: 2n, shooter_id: "s1", a_hits: 8n, c_hits: 4n, d_hits: 0n, mikes: 1n },
];
cases.push({ name: "payload stage results array", value: stage_results, expectJson: JSON.stringify(stage_results, (_k, v) => typeof v === "bigint" ? Number(v) : v) });

// Empty result set
cases.push({ name: "payload empty result set", value: [], expectJson: "[]" });

// Single-row count query
cases.push({ name: "payload single count row", value: [{ count: 1234n }], expectJson: '[{"count":1234}]' });

// Aggregation row with bigint sum (could exceed safe range in theory)
cases.push({ name: "payload aggregation in-range", value: [{ total: 1000000n, avg: 50.5 }], expectJson: '[{"total":1000000,"avg":50.5}]' });
cases.push({ name: "payload aggregation out-of-range", value: [{ total: 999999999999999999999n }], expectJson: '[{"total":"999999999999999999999"}]' });

// Upcoming matches query shape
const upcoming = [
  { id: 12345n, name: "Future Match", start_date: "2026-05-01", state: "Arizona" },
  { id: 12346n, name: "Another Match", start_date: "2026-05-02", state: "Arizona" },
];
cases.push({ name: "payload upcoming matches", value: upcoming, expectJson: '[{"id":12345,"name":"Future Match","start_date":"2026-05-01","state":"Arizona"},{"id":12346,"name":"Another Match","start_date":"2026-05-02","state":"Arizona"}]' });

// Registrations shape
const regs = [
  { match_uuid: "u1", shooter_name: "Smith, John", squad_number: 1, division: "Carry Optics" },
  { match_uuid: "u1", shooter_name: "Doe, Jane", squad_number: 2, division: "Production" },
];
cases.push({ name: "payload registrations", value: regs, expectJson: JSON.stringify(regs) });

// Field stats per stage
const field_stats = {
  match_uuid: "u1",
  stage_num: 1n,
  num_shooters: 75n,
  best_hit_factor: 8.5,
  median_hit_factor: 4.2,
};
cases.push({ name: "payload field stats", value: field_stats, expectJson: JSON.stringify(field_stats, (_k, v) => typeof v === "bigint" ? Number(v) : v) });

// Match results with mixed types
const match_results_mixed = {
  rows: [
    { shooter_id: "x1", overall_place: 1n, match_pct: 100, dq: false },
    { shooter_id: "x2", overall_place: 2n, match_pct: 85.3, dq: false },
    { shooter_id: "x3", overall_place: null, match_pct: null, dq: true },
  ],
  meta: { count: 3n, division: "Open" },
};
cases.push({ name: "payload match_results mixed", value: match_results_mixed, expectJson: JSON.stringify(match_results_mixed, (_k, v) => typeof v === "bigint" ? Number(v) : v) });

// Identity links
const identity_link = {
  shooter_id: "mmShooter_555",
  canonical_id: "tran-dennis",
  tier: "name_member",
  confidence: 0.98,
  linked_at: new Date(Date.UTC(2026, 3, 1)),
};
cases.push({ name: "payload identity link", value: identity_link, expectJson: JSON.stringify(identity_link) });

// Validation log row
const validation_row = {
  run_at: new Date(Date.UTC(2026, 3, 25, 6, 0, 0)),
  check_id: 1n,
  status: "pass",
  details: { expected: 100n, actual: 100n },
};
cases.push({ name: "payload validation row", value: validation_row, expectJson: JSON.stringify(validation_row, (_k, v) => typeof v === "bigint" ? Number(v) : v) });

// Empty object payload
cases.push({ name: "payload empty obj", value: {}, expectJson: "{}" });

// Mixed pg row simulating INT8 mixed with INT4
const pg_row_int_mix = {
  int4_id: 42, // pg INT4 -> JS number
  int8_count: "9999", // pg INT8 default -> string
  int8_bigint_safe: 1234567890n, // hypothetical custom parser -> bigint, in-range
  int8_bigint_unsafe: 12345678901234567890n, // out-of-range bigint
  name: "test",
};
cases.push({
  name: "payload pg INT4+INT8 mixed",
  value: pg_row_int_mix,
  expectJson: '{"int4_id":42,"int8_count":"9999","int8_bigint_safe":1234567890,"int8_bigint_unsafe":"12345678901234567890","name":"test"}',
});

// Dashboard summary with totals
const summary = {
  total_matches: 16234n,
  total_shooters: 4521n,
  total_stage_results: 41382712n,
  last_run: new Date(Date.UTC(2026, 3, 25, 8, 30)),
};
cases.push({
  name: "payload dashboard summary",
  value: summary,
  expectJson: JSON.stringify(summary, (_k, v) => typeof v === "bigint" ? Number(v) : v),
});

// Discipline breakdown
const breakdown = [
  { discipline: "USPSA", count: 1234n },
  { discipline: "IDPA", count: 567n },
  { discipline: "Steel Challenge", count: 890n },
  { discipline: "PCSL", count: 123n },
];
cases.push({ name: "payload discipline breakdown", value: breakdown, expectJson: '[{"discipline":"USPSA","count":1234},{"discipline":"IDPA","count":567},{"discipline":"Steel Challenge","count":890},{"discipline":"PCSL","count":123}]' });

// Edge: row with all-null fields
cases.push({ name: "payload all-null row", value: [{ a: null, b: null, c: null }], expectJson: '[{"a":null,"b":null,"c":null}]' });

// Edge: deeply nested dashboard widget
const widget = {
  type: "stat_card",
  data: {
    primary: { value: 1234n, label: "matches" },
    secondary: { value: 56789n, label: "shooters" },
    delta: { value: 12n, direction: "up" },
  },
};
cases.push({ name: "payload widget shape", value: widget, expectJson: JSON.stringify(widget, (_k, v) => typeof v === "bigint" ? Number(v) : v) });

// Edge: result with string-encoded INT8 (pg default behavior)
cases.push({ name: "payload pg default INT8 as string", value: [{ id: "9223372036854775807" }], expectJson: '[{"id":"9223372036854775807"}]' });

// ---------------------------------------------------------------------------
// Run + report
// ---------------------------------------------------------------------------

const result = runJsonCases(cases);

console.log(`Total: ${result.total}`);
console.log(`Pass:  ${result.pass}`);
console.log(`Fail:  ${result.fail}`);

if (result.fail > 0) {
  console.log("\nFirst 10 failures:");
  for (const f of result.failures.slice(0, 10)) {
    console.log(`  - ${f.name}`);
    console.log(`      expected: ${JSON.stringify(f.expected)}`);
    console.log(`      got:      ${JSON.stringify(f.got)}`);
  }
  process.exit(1);
}
process.exit(0);
