# OKF Toolkit

OKF Toolkit is the versioned TypeScript implementation for Open Knowledge Format
v0.2 bundles. It provides one parser, validator, link resolver, graph model,
visualizer, CLI contract, and storage adapter boundary for local files and R2.

Every operation targets exactly one bundle. The toolkit does not combine
search, links, graphs, or writes across bundles.

## Packages

- `okf-contracts`: JSON Schemas, the vendored v0.2 specification, and shared fixtures.
- `okf-core`: parsing, conformance, profiles, links, search, diffs, and bundle analysis.
- `okf-viz`: deterministic self-contained HTML visualization.
- `okf-node`: confined filesystem access, change application, and watch support.
- `okf-cloudflare`: R2, MCP, and Queue consumer support.
- `okf-cli`: the `okf` JSON CLI.
- `okf-signatures`: optional Ed25519 bundle-integrity manifests.

The workspace requires Node 24 and pnpm 10.28.2.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
```

The [`docs/adr`](docs/adr/) directory contains the architecture decisions.
[`docs/MIGRATION.md`](docs/MIGRATION.md) defines the coordinated consumer
migration and its completion checks. [`docs/RELEASE.md`](docs/RELEASE.md)
defines the signed-tag release process.
