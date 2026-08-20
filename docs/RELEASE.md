# Release an OKF Toolkit candidate

Build and publish each release candidate from one clean, signed repository
revision. Do not use `pnpm -r pack`: the workspace root is private and is not a
release artifact.

## Build the artifacts

Run the complete gate, then pack the seven public packages explicitly:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm pack:release
sha256sum -c release/1.0.0-rc.0/SHA256SUMS
```

`pack:release` refuses to overwrite an existing release directory. The
checksummed `okf-contracts` tarball is the portable contracts archive: it
contains the JSON Schemas, conformance fixtures, vendored OKF v0.2
specification, and notices used by every transport.

Inspect the tarballs before publication. In particular, confirm that the CLI
binary is executable, visualization third-party notices are present, workspace
dependencies became the exact candidate version, and no source, tests,
credentials, or environment files are included.

## Publish in dependency order

Publish the exact tarballs under the `next` tag, in this order:

```bash
npm publish release/1.0.0-rc.0/okf-contracts-1.0.0-rc.0.tgz --tag next
npm publish release/1.0.0-rc.0/okf-core-1.0.0-rc.0.tgz --tag next
npm publish release/1.0.0-rc.0/okf-viz-1.0.0-rc.0.tgz --tag next
npm publish release/1.0.0-rc.0/okf-node-1.0.0-rc.0.tgz --tag next
npm publish release/1.0.0-rc.0/okf-signatures-1.0.0-rc.0.tgz --tag next
npm publish release/1.0.0-rc.0/okf-cloudflare-1.0.0-rc.0.tgz --tag next
npm publish release/1.0.0-rc.0/okf-cli-1.0.0-rc.0.tgz --tag next
```

Attach all seven tarballs and `SHA256SUMS` to the matching GitHub prerelease.
Before you retire an old validator, visualizer, or transport, confirm that each
consumer lockfile resolves the exact candidate version.
