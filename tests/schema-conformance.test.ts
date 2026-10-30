import test from "node:test";
import assert from "node:assert/strict";
import { ANALYSIS_SCHEMA, BRIEF_SCHEMA, CLARIFY_SCHEMA } from "../src/lib/meta/schemas";

// Constraints taken from https://dev.meta.ai/docs/structured-output (strict subset + schema limits).
type S = Record<string, unknown>;
function inspect(schema: S, depth = 1, acc = { maxDepth: 1, props: 0, enums: 0, chars: 0 }) {
  acc.maxDepth = Math.max(acc.maxDepth, depth);
  for (const banned of ["allOf", "oneOf", "$ref", "not"]) assert.equal(banned in schema, false, `${banned} not allowed`);
  if (Array.isArray(schema.enum)) { acc.enums += schema.enum.length; acc.chars += (schema.enum as string[]).join("").length; }
  if (schema.type === "object") {
    const props = (schema.properties ?? {}) as Record<string, S>;
    assert.equal(schema.additionalProperties, false, "every object must set additionalProperties:false");
    assert.deepEqual([...(schema.required as string[])].sort(), Object.keys(props).sort(), "required must list every property");
    for (const [k, v] of Object.entries(props)) { acc.props++; acc.chars += k.length; inspect(v, depth + 1, acc); }
  }
  if (schema.type === "array") inspect(schema.items as S, depth + 1, acc);
  return acc;
}

for (const [name, schema] of Object.entries({ ANALYSIS_SCHEMA, CLARIFY_SCHEMA, BRIEF_SCHEMA })) {
  test(`${name} satisfies the documented strict subset and size limits`, () => {
    const r = inspect(schema as unknown as S);
    assert.equal((schema as S).type, "object", "root must be a plain object");
    assert.ok(r.maxDepth <= 10, `nesting depth ${r.maxDepth} must be <= 10`);
    assert.ok(r.props <= 5000 && r.enums <= 1000 && r.chars <= 120000);
  });
}
