# Release OKF Toolkit

GitHub Actions builds and publishes every OKF Toolkit release from a signed Git
tag and its matching GitHub release. Do not publish a toolkit release from a
workstation. The name bootstrap described in this guide is not a release.

The `.github/workflows/release.yml` workflow starts when you publish a GitHub
release for an annotated, signed tag named `v<version>`. The tag must point to the
reviewed release commit, and `<version>` must match the root manifest and all
seven package manifests.

## Create the release tag

Before you tag a commit, confirm that the release version is valid SemVer and
that all release checks pass:

```bash
pnpm install --frozen-lockfile
pnpm check
node scripts/verify-release.mjs --tag v1.0.0-rc.1
```

Create, verify, and push the signed tag:

```bash
git tag -s v1.0.0-rc.1 -m "Release v1.0.0-rc.1"
git verify-tag v1.0.0-rc.1
git push origin v1.0.0-rc.1
```

Do not move a release tag after you push it. Create the matching GitHub
prerelease only after the tag is available on GitHub:

```bash
gh release create v1.0.0-rc.1 \
  --verify-tag \
  --title v1.0.0-rc.1 \
  --generate-notes \
  --prerelease
```

For a stable version, omit `--prerelease`. Publishing the GitHub release is the
publication request.

## GitHub Actions release

The release workflow separates building, npm publication, and GitHub release
assets. Only the npm publication job uses the protected `npm-release` GitHub
environment. Keep required reviewers and tag deployment rules on that
environment. Add the environment variable `NPM_RELEASE_GATE=enabled`; the
publication job does not run when that variable is absent.

For the tagged commit, the workflow:

1. The build job checks out the tagged commit and verifies the signed tag,
   version agreement, package metadata, and release plan. It installs the frozen
   lockfile, runs `pnpm check`, packs once, checks each tarball, and installs all
   seven OKF packages from the packed artifacts in a clean project. It uploads
   the complete release directory as one immutable Actions artifact.
2. The npm publication job downloads and verifies that artifact without checking
   out repository code. After the `npm-release` environment approves the job, it
   publishes the exact tarballs with `--provenance --ignore-scripts --access
   public` in the required dependency order.
3. The release-assets job downloads and verifies the same artifact, then attaches
   the seven tarballs, `SHA256SUMS`, and `RELEASE.json` to the GitHub release that
   started the workflow.

The dependency order is:

1. `okf-contracts`
2. `okf-core`
3. `okf-viz`
4. `okf-node`
5. `okf-signatures`
6. `okf-cloudflare`
7. `@disusered/okf-cli`

A SemVer prerelease such as `1.0.0-rc.1` uses the npm `next` distribution tag
and requires a GitHub prerelease. A stable version such as `1.0.0` uses `latest`
and requires a standard GitHub release.

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

If publication stops after one or more packages reach npm, use **Re-run failed
jobs** on the same workflow run. This keeps the successful build job and its
artifact. Do not create a replacement release or tag, and do not increment the
version only to retry the workflow. The build artifact expires after seven
days, so resolve a partial publication before that deadline.

npm can accept a package and return success before that version is available
through every registry endpoint. The workflow allows just over two minutes for
the version and distribution tag to appear, then the same time for provenance.
A retry also detects a distribution tag that already points to a version still
being processed and waits instead of trying to publish that immutable version
again.

Before it skips an existing package version, the workflow compares the npm
`dist.integrity` value with the integrity of the packed tarball. It stops if the
values differ. If they match, it skips that package and continues in dependency
order. The GitHub release uses the same rule for existing assets, so a retry
does not rebuild or replace published artifacts.

Before you retire an old validator, visualizer, or transport, confirm that each
consumer lockfile resolves the exact candidate version.
