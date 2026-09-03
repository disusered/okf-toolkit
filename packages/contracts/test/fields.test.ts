import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  OKF_ACTOR,
  OKF_ATTESTED_COMPUTATION,
  OKF_DATE,
  OKF_DATETIME,
  OKF_STATUSES,
  OKF_V02_ATTESTED_COMPUTATION_FIELDS,
  OKF_V02_CONCEPT_FIELDS,
  OKF_V02_ROOT_INDEX_FIELDS,
  okfFieldsForType,
  okfTypeKey,
  type OkfFieldDescriptor,
} from "../src/index.js";

function walk(fields: readonly OkfFieldDescriptor[]): OkfFieldDescriptor[] {
  return fields.flatMap((field) => [field, ...walk(field.of ?? [])]);
}

const ALL = walk([
  ...OKF_V02_CONCEPT_FIELDS,
  ...OKF_V02_ATTESTED_COMPUTATION_FIELDS,
  ...OKF_V02_ROOT_INDEX_FIELDS,
]);

test("the common set is exactly the keys SPEC 4.1 and 5 name", () => {
  assert.deepEqual(
    OKF_V02_CONCEPT_FIELDS.map((field) => field.key),
    [
      "type",
      "title",
      "description",
      "resource",
      "tags",
      "status",
      "stale_after",
      "generated",
      "verified",
      "sources",
      "usage_window",
    ],
  );
});

test("only `type` is required of a concept, per SPEC 4.1 and 11", () => {
  const required = OKF_V02_CONCEPT_FIELDS.filter((field) => field.required).map((field) => field.key);
  assert.deepEqual(required, ["type"]);
});

test("a field required within its container is marked there, not at the top", () => {
  const within = (parent: string, child: string): boolean => {
    const found = ALL.find((field) => field.key === parent);
    return (found?.of ?? []).some((entry) => entry.key === child && entry.required === true);
  };
  assert.ok(within("generated", "by"), "generated.by is REQUIRED within generated (SPEC 5.2)");
  assert.ok(within("verified", "by"), "verified[].by names an actor (SPEC 5.2)");
  assert.ok(within("sources", "resource"), "sources[].resource is REQUIRED within an entry (SPEC 5.1)");
  assert.ok(within("parameters", "name"), "parameters[].name (SPEC 10.2)");
});

test("the status domain is the one okf-core validates", () => {
  const status = OKF_V02_CONCEPT_FIELDS.find((field) => field.key === "status");
  assert.equal(status?.widget, "select");
  assert.deepEqual(status?.options, OKF_STATUSES);
  assert.deepEqual([...OKF_STATUSES], ["draft", "stable", "deprecated"]);
});

test("the grammars accept what SPEC 5 and 7 write and refuse what they do not", () => {
  assert.ok(OKF_DATE.test("2026-09-23"));
  assert.ok(!OKF_DATE.test("23-09-2026"));
  assert.ok(OKF_DATETIME.test("2026-06-20T22:53:05Z"));
  assert.ok(OKF_DATETIME.test("2026-06-20T22:53:05+02:00"));
  assert.ok(!OKF_DATETIME.test("2026-06-20"));
  for (const actor of ["human:ahormati", "process:finance-nightly", "reference_agent/gemini-2.5-pro"]) {
    assert.ok(OKF_ACTOR.test(actor), actor);
  }
  assert.ok(!OKF_ACTOR.test("ahormati"));
});

test("every descriptor cites a section that exists in the vendored specification", async () => {
  const spec = await readFile(new URL("../../spec/SPEC.md", import.meta.url), "utf8");
  for (const field of ALL) {
    assert.match(field.help, /\S/, `${field.key} carries help text`);
    assert.match(
      spec,
      new RegExp(`^#{2,3} ${field.spec.replace(".", "\\.")}[. ]`, "m"),
      `${field.key} cites SPEC ${field.spec}`,
    );
  }
});

test("a bare `select` is the only widget carrying options, and every option list is closed", () => {
  for (const field of ALL) {
    assert.equal(
      field.options !== undefined,
      field.widget === "select",
      `${field.key} pairs options with the select widget`,
    );
    assert.equal(field.of !== undefined, field.widget === "group" || field.widget === "list", field.key);
  }
});

test("type keys fold spelling variants together without becoming a registry", () => {
  assert.equal(okfTypeKey("ProjectBrief"), "project brief");
  assert.equal(okfTypeKey("Project Brief"), "project brief");
  assert.equal(okfTypeKey("project-brief"), "project brief");
  assert.equal(okfTypeKey(OKF_ATTESTED_COMPUTATION), "attested computation");
});

test("only Attested Computation adds fields; an unknown type adds none", () => {
  assert.deepEqual(okfFieldsForType("Runbook"), OKF_V02_CONCEPT_FIELDS);
  assert.deepEqual(okfFieldsForType(null), OKF_V02_CONCEPT_FIELDS);
  assert.deepEqual(okfFieldsForType("Something Nobody Registered"), OKF_V02_CONCEPT_FIELDS);

  const attested = okfFieldsForType("attested-computation").map((field) => field.key);
  assert.deepEqual(attested.slice(0, OKF_V02_CONCEPT_FIELDS.length), OKF_V02_CONCEPT_FIELDS.map((f) => f.key));
  assert.deepEqual(attested.slice(OKF_V02_CONCEPT_FIELDS.length), [
    "runtime",
    "parameters",
    "computation",
    "executor",
    "attester",
  ]);
});

test("a root index may carry `okf_version` and nothing else", () => {
  assert.deepEqual(
    OKF_V02_ROOT_INDEX_FIELDS.map((field) => field.key),
    ["okf_version"],
  );
});
