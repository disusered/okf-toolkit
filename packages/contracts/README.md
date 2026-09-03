# okf-contracts

`okf-contracts` defines the data exchanged by OKF Toolkit packages and
processes. It has no dependencies and publishes TypeScript declarations,
strict JSON Schemas, language-neutral conformance fixtures, and a pinned
verbatim copy of the OKF v0.2 specification.

- `okf.inspect.v1` is the deterministic full-bundle analysis returned by
  `okf inspect --json`.
- `okf.operations.v1` covers create, update, delete, move, preview, and apply
  results. Revisions are opaque strings.
- `okf-contracts/fields` describes the frontmatter vocabulary §4.1, §5, §7, and
  §10.2 specify, as data, so an editor renders a form from the same source the
  validators read. It is a vocabulary, not a schema: §11 forbids rejecting a
  document for an unknown `type` or an unknown key, and a consumer's own Profile
  still decides what is legal. It is a subpath of its own so a browser can
  import it without the MCP server and the schema validator that the main entry
  pulls in.
- `fixtures/conformance/` separates core format failures, soft guidance,
  profile-only findings, reserved-file structure, and JSON-safe metadata
  projection. Each fixture is language-neutral JSON so every runtime can verify
  the same diagnostic categories and codes.

`NOTICE` and the header of `spec/SPEC.md` record the vendored specification's
source commit, copyright, and license.
