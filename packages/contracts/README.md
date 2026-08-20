# okf-contracts

`okf-contracts` defines the data exchanged by OKF Toolkit packages and
processes. It has no dependencies and publishes TypeScript declarations,
strict JSON Schemas, language-neutral conformance fixtures, and a pinned
verbatim copy of the OKF v0.2 specification.

- `okf.inspect.v1` is the deterministic full-bundle analysis returned by
  `okf inspect --json`.
- `okf.operations.v1` covers create, update, delete, move, preview, and apply
  results. Revisions are opaque strings.
- `fixtures/conformance/` separates core format failures, soft guidance,
  profile-only findings, reserved-file structure, and JSON-safe metadata
  projection. Each fixture is language-neutral JSON so every runtime can verify
  the same diagnostic categories and codes.

`NOTICE` and the header of `spec/SPEC.md` record the vendored specification's
source commit, copyright, and license.
