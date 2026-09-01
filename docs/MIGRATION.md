# Unified OKF migration

Move every consumer to the toolkit as one coordinated change. Do not retain an
indefinite compatibility layer. Every consumer pins the same release candidate
and retains ownership of its domain policy.

## Gate 1: shared contracts

- Freeze `okf.inspect.v1` and `okf.operations.v1` JSON Schemas.
- Run the OKF v0.2 conformance fixtures against the core.
- Verify that filesystem and R2 adapters produce the same Bundle Analysis for
  the same bytes.
- Verify that repeated visualization builds produce identical HTML bytes for the same
  `(bundle, analysis, evaluatedAt)`. `evaluatedAt` is an input, omitted by default; when a
  consumer supplies it the bytes depend on that date by construction, and the page prints
  the date it was judged against so the artifact stays reproducible from the bundle plus
  its own printed date.
- Publish exact-version `1.0.0-rc.N` packages and a checksummed contracts
  archive by following [`RELEASE.md`](RELEASE.md).

Exit: the API, CLI, MCP factory, and visualizer use one versioned analysis
shape and all workspace tests pass on Node 24.

## Gate 2: Herding Cats and XBOL

- Install the exact `@disusered/okf-cli` release candidate.
- Make generic Polychrome operations delegate to the CLI while keeping
  federation, Black, Red, Marginalia, Zotero, Journal, and Portal behavior in
  `polychromectl`.
- Make `xbol-index` consume `okf inspect --json` while retaining its semantic,
  SQLite, Neo4j, and OpenViking projections.
- Replace duplicate validators and visualizers only after their validation
  results and generated HTML match the shared toolkit.

Exit: both Bundles retain their clean validation baselines, consumer tests
pass, and neither Consumer contains a second generic OKF parser.

## Gate 3: Iteramind private and shared

- Use CLI plus the filesystem adapter for the Private Bundle; do not run a
  local MCP server.
- Compose the hosted Worker from Iteramind Access and author policy plus the
  versioned Cloudflare MCP/R2 implementation.
- Serialize reviewed hosted applies for the fixed Bundle through one Durable
  Object instance; author allowlisting is not a concurrency guarantee.
- Attach R2 notifications, a Queue, and a dead-letter queue so source object
  changes rebuild a deterministic viewer outside the watched prefix.
- Run authenticated read, change, validation, and viewer checks in the
  deployment workflow.

Exit: private paths are unreachable from the shared deployment, all lifecycle
operations are conditionally safe, and create, update, delete, and move events
rebuild the same viewer without cross-Bundle behavior.

## Gate 4: retire duplicates and release v1

- Archive the Iteramind local MCP, profile-only validator, and separate viewer
  repositories after their responsibilities have moved.
- Remove the dotfiles renderer and duplicated skill adapters after every
  harness resolves the canonical transport-neutral skill.
- Preserve repository history and migration receipts; do not keep deprecated
  generic wrappers in active paths.
- Publish `1.0.0` only when all Consumers pass against the same release
  candidate.

## Deferred work

- Read-only cross-Bundle discovery and linking.
- Code Mode over the stable toolkit API.
- DataBook profiles and semantic execution.
- Any source archive or Zotero replacement.
- Mermaid and product-specific visualization features.
- Cross-consumer visual theming beyond the trust and freshness signals now surfaced.
- Replacement of the historical Brain Portal projection.
