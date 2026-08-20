# Release OKF Toolkit

GitHub Actions builds and publishes every OKF Toolkit release from a signed Git
tag and its matching GitHub release. Do not run `npm publish` on a workstation.

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
node scripts/verify-release.mjs --tag v1.0.0-rc.0
```

Create, verify, and push the signed tag:

```bash
git tag -s v1.0.0-rc.0 -m "Release v1.0.0-rc.0"
git verify-tag v1.0.0-rc.0
git push origin v1.0.0-rc.0
```

Do not move a release tag after you push it. Create the matching GitHub
prerelease only after the tag is available on GitHub:

```bash
gh release create v1.0.0-rc.0 \
  --verify-tag \
  --title v1.0.0-rc.0 \
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
7. `okf-cli`

A SemVer prerelease such as `1.0.0-rc.0` uses the npm `next` distribution tag
and requires a GitHub prerelease. A stable version such as `1.0.0` uses `latest`
and requires a standard GitHub release.

## Configure npm trusted publishing

After the packages exist on npm, each package must use the same GitHub Actions
trusted-publisher settings:

- Organization or user: `disusered`
- Repository: `okf-toolkit`
- Workflow: `release.yml`
- Environment: `npm-release`
- Permission: allow publishing

The release workflow uses OpenID Connect (OIDC) for npm authentication. After
bootstrap, the workflow does not use an npm token. Configure each package to
disallow token-based publishing after you verify its trusted publisher.

## Bootstrap the packages on npm

npm requires a package to exist before you can configure its trusted publisher.
Use a temporary token only for the first publication of these package names:

1. Create a granular npm token that expires after one day, with read and write access to
   **All Packages**, and bypass 2FA enabled.
2. Store it as `NPM_BOOTSTRAP_TOKEN` only in the protected `npm-release` GitHub
   environment.
3. Push the first signed release tag, publish its matching GitHub release, and
   approve the protected environment.
4. Configure the settings in **Configure npm trusted publishing** for all seven
   packages, with publishing allowed.
5. Delete `NPM_BOOTSTRAP_TOKEN` from GitHub, revoke the npm token, and configure
   each package to disallow token-based publishing.

Do not store the bootstrap token in a local `.npmrc`, a repository-level secret,
or a workflow file.

## Retry a partial release

If publication stops after one or more packages reach npm, use **Re-run failed
jobs** on the same workflow run. This keeps the successful build job and its
artifact. Do not create a replacement release or tag, and do not increment the
version only to retry the workflow. The build artifact expires after seven
days, so resolve a partial publication before that deadline.

Before it skips an existing package version, the workflow compares the npm
`dist.integrity` value with the integrity of the packed tarball. It stops if the
values differ. If they match, it skips that package and continues in dependency
order. The GitHub release uses the same rule for existing assets, so a retry
does not rebuild or replace published artifacts.

Before you retire an old validator, visualizer, or transport, confirm that each
consumer lockfile resolves the exact candidate version.
