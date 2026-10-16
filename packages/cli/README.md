# @disusered/okf-cli

`@disusered/okf-cli` installs the `okf` binary. The CLI writes deterministic
JSON by default and accepts `--json` so calling programs can state the contract
explicitly. Every command operates on exactly one bundle.

```sh
okf inspect docs --json
okf validate docs --strict
okf search docs "box office"
okf read docs concepts/settlement.md
okf index docs
okf index docs concepts
okf visualize docs --out .okf/viz.html
okf watch docs --out .okf/viz.html
okf mcp . --bundle docs
```

When a target is a repository rather than a bundle root, discovery uses only
`.agents/okf.yaml`. Use `--bundle NAME` when the manifest declares more than one
bundle.

## Directory navigation

`okf index [target] [directory]` emits `okf.index.v1` JSON, including generated
Markdown in `content`. Omit the directory for the root. It reads current titles
and descriptions on every invocation and never overwrites authored files.

`okf visualize` embeds the same indexes in the reader's **Browse pages** panel.
`okf watch` regenerates them with the viewer whenever Markdown changes. After
a CLI change, call `index` for current navigation or use `watch` for a saved
viewer that updates automatically.

## Change operations

Changes are JSON on standard input by default, or from `--input FILE`. Preview
the exact file, review its diff and diagnostics, then pass its `preview_id` to
apply:

```sh
okf change preview docs --input change.json
okf change apply docs --input change.json --preview-id sha256:REVIEWED_ID
```

The accepted operations are `create`, `update`, `delete`, and `move`. Updates,
deletes, and moves require `expected_revision`. Apply rejects a missing or
mismatched preview ID before mutation. It then validates the proposed bundle,
rechecks live filesystem state, writes the change to disk, and validates the
result. Repeating an accepted request returns `unchanged` if the requested state
already exists.

## Consumer profiles

The base CLI has no named profile registry and rejects `--profile NAME`.
Trusted local wrappers can explicitly pass `--profile-module FILE`, where the
built JavaScript module exports a `profile` object compatible with
`okf-core`'s `ValidationProfile`. Hosted consumers compose profiles directly in
code. The CLI never executes validation command arrays from a manifest.

## MCP server

`okf mcp` serves one filesystem bundle's versioned `okf_v1_*` tools over MCP.
stdio is the default; `--http` serves loopback HTTP at
`http://127.0.0.1:1934/v1/mcp` plus `GET /healthz`.

```sh
okf mcp /srv/knowledge --bundle team
okf mcp /srv/knowledge --bundle team --http --port 1934 \
  --allowed-host knowledge-mcp.example.com \
  --name example-knowledge --title "Example Knowledge" \
  --purpose "Example's shared knowledge: decisions, policies, and runbooks."
```

- `<project-root>` comes from the command line, never the working directory,
  and `--bundle` is always required, so a typo fails at startup.
- The manifest's `access` decides what is served: `read` refuses
  `okf_v1_preview_change` and `okf_v1_apply_change`; `read-write`, or no value,
  serves all eleven tools.
- The HTTP listener binds `127.0.0.1` only and refuses any `Host` or `Origin`
  that is neither localhost nor an `--allowed-host`. Name the public hostname a
  tunnel forwards with `--allowed-host`; the tunnel's edge authenticates
  callers.
- `--name`, `--title`, `--description`, `--website`, `--icon`, and `--purpose`
  set what a client lists and what a model reads first. `--purpose` opens the
  server instructions.
- `okf_v1_visualize` writes its page to a temporary directory and returns a
  `file:` URL.

An application embeds the same server, and may add its own tools beside it:

```ts
import { createOkfLocalServer, serveHttp } from "@disusered/okf-cli";

const local = await createOkfLocalServer({
  projectRoot: "/srv/knowledge",
  bundle: "team",
  name: "example-knowledge",
  version: "1.4.0",
  identity: { title: "Example Knowledge", purpose: "Example's shared knowledge." },
});
await serveHttp(() => local.createServer(), {
  port: 1934,
  allowedHosts: ["knowledge-mcp.example.com"],
  service: "example-knowledge",
  version: "1.4.0",
});
```

## Exit status

- `0`: command completed, validation passed, or a change was applied/unchanged.
- `1`: validation failed or a change preview/apply was rejected.
- `2`: arguments, I/O, configuration, or input were invalid. The error is JSON
  on standard error.
