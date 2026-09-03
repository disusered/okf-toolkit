# Release OKF Toolkit

GitHub Actions builds and publishes every OKF Toolkit release from a signed Git
tag and its matching GitHub release. Do not publish a toolkit release from a
workstation. The name bootstrap described in this guide is not a release.

The `.github/workflows/release.yml` workflow starts when you publish a GitHub
release for an annotated, signed tag named `<name>@<version>` — `okf-viz@2.0.0`,
or `@disusered/okf-cli@1.2.0` for the scoped name. The tag must point to the
reviewed release commit, and `<version>` must match that package's manifest.

**One release publishes one package.** Package versions are independent: nothing
requires two packages to carry the same version, and the workspace root's
version is not a release version at all. Publishing `okf-viz` leaves every other
package's registry version exactly where it was.

When several packages change together, release them one at a time in dependency
order. `pnpm pack` rewrites each `workspace:*` range to the version that
dependency currently carries in the workspace, so that version must already be
on npm — `scripts/check-release-install.mjs` installs the tarball from the
registry and fails the release if it is not.

## Create the release tag

Before you tag a commit, confirm that the release version is valid SemVer and
that all release checks pass:

```bash
pnpm install --frozen-lockfile
pnpm check
node scripts/verify-release.mjs --tag okf-viz@2.0.0
```

Run without `--tag` to check every package and the dependency order instead of
one release.

Create, verify, and push the signed tag:

```bash
git tag -s okf-viz@2.0.0 -m "Release okf-viz@2.0.0"
git verify-tag okf-viz@2.0.0
git push origin okf-viz@2.0.0
```

Do not move a release tag after you push it. Create the matching GitHub
prerelease only after the tag is available on GitHub:

```bash
gh release create okf-viz@2.0.0 \
  --verify-tag \
  --title okf-viz@2.0.0 \
  --generate-notes
```

Add `--prerelease` for a SemVer prerelease such as `okf-viz@2.0.0-rc.1`.

Publishing the GitHub release is the publication request.

## Let the environment accept the tag

The `npm-release` environment restricts which refs may deploy to it, and that rule
lives in GitHub settings rather than in this repository. Nothing here can test it:
`pnpm check` passes, the build job passes, the tarball is packed and verified, and
the deploy is then rejected in about two seconds before a single step runs.

Under **Settings → Environments → npm-release → Deployment branches and tags**, the
allowed tag patterns must cover the release tag format. Two rules cover every
package, present and future:

```
okf-*@*
@disusered/okf-cli@*
```

Two rules are needed rather than one because a deployment pattern's `*` does not
match `/`, and the CLI's name carries a scope. A `v*` rule from before per-package
versioning is harmless to leave in place, and matches nothing that is released now.

**Adding a package means adding its pattern**, unless its name starts with `okf-`.

## GitHub Actions release

The release workflow separates building, npm publication, and GitHub release
assets. Only the npm publication job uses the protected `npm-release` GitHub
environment. Keep required reviewers and tag deployment rules on that
environment. Add the environment variable `NPM_RELEASE_GATE=enabled`; the
publication job does not run when that variable is absent.

For the tagged commit, the workflow:

1. The build job checks out the tagged commit and verifies the signed tag, the
   package metadata, and the release plan. It installs the frozen lockfile, runs
   `pnpm check`, packs the one tagged package, checks its tarball, and installs
   it from that tarball in a clean project with its dependencies resolved from
   npm. It uploads the release directory as one immutable Actions artifact.
2. The npm publication job downloads and verifies that artifact without checking
   out repository code. It reads the package name and version from
   `RELEASE.json` rather than splitting the tag, because a scoped name carries
   its own `@`. After the `npm-release` environment approves the job, it
   publishes that one tarball with `--provenance --ignore-scripts --access
   public`.
3. The release-assets job downloads and verifies the same artifact, then attaches
   the tarball, `SHA256SUMS`, and `RELEASE.json` to the GitHub release that
   started the workflow.

Releases are per package, so the list below is a repository invariant rather
than a schedule: a package may only depend on one that appears before it, and
`scripts/release-config.mjs` refuses a workspace that breaks the order.

1. `okf-contracts`
2. `okf-core`
3. `okf-viz`
4. `okf-node`
5. `okf-signatures`
6. `okf-cloudflare`
7. `@disusered/okf-cli`

A SemVer prerelease such as `okf-viz@2.0.0-rc.1` uses the npm `next`
distribution tag and requires a GitHub prerelease. A stable version uses
`latest` and requires a standard GitHub release.

## Bootstrap a package name

npm exposes Trusted Publisher settings after the package name exists. For each
new package name, publish a minimal `0.0.0-bootstrap` package under the
`bootstrap` tag from an authenticated workstation. Use interactive 2FA. Do not
create an automation token or include toolkit code in the bootstrap package.

npm assigns `latest` to the first version of a package even when the publish
command specifies another tag. npm requires every package to have a `latest`
tag, so deprecate the bootstrap version to warn anyone who installs it. The
first stable release replaces `latest`; a release candidate uses `next`. Do not
create a Git tag or GitHub release for the bootstrap version.

```bash
npm deprecate PACKAGE_NAME@0.0.0-bootstrap \
  "Bootstrap placeholder. Install an exact release or use the next tag."
```

## Configure npm trusted publishing

Configure each package by following the
[npm trusted publishing guide](https://docs.npmjs.com/trusted-publishers). The
trusted publisher uses these values:

- Organization or user: `disusered`
- Repository: `okf-toolkit`
- Workflow: `release.yml`
- Environment: `npm-release`
- Allowed action: `npm publish`

Run these commands from an authenticated workstation with npm 11.15.0 or later:

```bash
packages=(
  okf-contracts
  okf-core
  okf-viz
  okf-node
  okf-signatures
  okf-cloudflare
  @disusered/okf-cli
)

for package in "${packages[@]}"; do
  npm trust github "$package" \
    --repo disusered/okf-toolkit \
    --file release.yml \
    --env npm-release \
    --allow-publish \
    --yes
  npm access set mfa=publish "$package"
  npm trust list "$package" --json
done
```

The local npm session changes package settings; it is not a release credential.
The workflow configuration must match every value. The release job runs on a
GitHub-hosted runner with `id-token: write`, Node 24, and npm 11.5.1 or later.

The release workflow uses OpenID Connect (OIDC) for npm authentication. It does
not read an npm token from GitHub secrets or the workstation. npm generates a
provenance attestation for each public package published from the public
repository, and the workflow verifies that attestation before it completes.

The `mfa=publish` setting selects **Require two-factor authentication and
disallow tokens**. The trusted publisher continues to work because it uses
short-lived OIDC credentials instead of traditional npm tokens.

Do not create an npm automation token for the release workflow. Do not add
`NODE_AUTH_TOKEN`, `NPM_TOKEN`, or another npm publish secret to the release
job.

## Retry a partial release

If publication fails after npm accepts the package, use **Re-run failed jobs**
on the same workflow run. This keeps the successful build job and its artifact.
Do not create a replacement release or tag, and do not increment the version
only to retry the workflow. The build artifact expires after seven days, so
resolve a partial publication before that deadline.

A release that publishes one package cannot leave the others half-published,
which is the failure mode the old workspace-wide release had.

npm can accept a package and return success before that version is available
through every registry endpoint. The workflow allows just over two minutes for
the version and distribution tag to appear, then the same time for provenance.
A retry also detects a distribution tag that already points to a version still
being processed and waits instead of trying to publish that immutable version
again.

Before it skips an existing package version, the workflow compares the npm
`dist.integrity` value with the integrity of the packed tarball. It stops if the
values differ. If they match, it skips the publication and verifies provenance.
The GitHub release uses the same rule for existing assets, so a retry does not
rebuild or replace published artifacts.

Before you retire an old validator, visualizer, or transport, confirm that each
consumer lockfile resolves the exact candidate version.
