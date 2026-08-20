# okf-core

`okf-core` is the storage-neutral OKF v0.2 library. It analyzes an in-memory list
of bundle-relative Markdown documents and returns `okf.inspect.v1`.

```ts
import { analyzeBundle } from "okf-core";

const analysis = analyzeBundle(documents, {
  today: "2026-08-20",
  profile: consumerProfile,
});
```

Analysis does not depend on a clock, filesystem, network, registry, or second
bundle. The library retains YAML source byte-for-byte beside its parsed mapping
and reads Markdown links from a CommonMark AST. Conformance errors, format
guidance, and consumer profile findings remain separate throughout the result.

## Metadata and profile boundaries

`content`, `frontmatter.raw`, and `frontmatter.yaml` retain authored bytes. The
`metadata` field is the JSON-safe projection used by `okf.inspect.v1`: all
unknown keys and JSON values are retained, non-cyclic aliases are expanded by
value, and unsafe mappings such as cyclic aliases or non-finite numbers produce
a deterministic `core.*.frontmatter.non-json` error. The original `content`
remains available even when no parsed snapshot can be emitted.

Profiles are untrusted extensions at this boundary. The engine fixes their
diagnostic family and profile ID, supplies the default `error` severity,
sanitizes valid source ranges, and throws a deterministic `TypeError` for an
invalid result before returning a partial `BundleAnalysis`.

Trust timestamps use deterministic syntax checks: an ISO 8601 datetime must
include seconds and either `Z` or an explicit numeric offset. Existing
`YYYY-MM-DD` values remain accepted as a compatibility form. Actor-convention
violations (`<producer>/<version>`, `human:<id>`, or `process:<id>`) are soft
guidance, not core conformance failures.

Reserved-file conformance is structural. Heading and list checks use a
CommonMark tree, so examples inside code fences do not count. Every `log.md`
requires H2 `YYYY-MM-DD` groups in newest-first order, and each group requires
at least one top-level list of entries before the next H2.
