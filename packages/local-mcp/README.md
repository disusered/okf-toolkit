# @disusered/okf-mcp

`@disusered/okf-mcp` installs the `okf-mcp` binary: a local MCP server that
serves exactly one filesystem OKF bundle to a client that cannot reach the
files itself. It runs on the user's machine, reads Markdown off disk, and talks
to no network storage.

```sh
okf-mcp /home/you/knowledge-repository --bundle private
```

The versioned `okf_v1_*` tool surface comes from `okf-mcp`, the bundle from
`okf-node`, and the results are the ones `@disusered/okf-cli` produces for the
same bundle.

## Usage

```
okf-mcp <project-root> --bundle NAME [--profile-module PATH] [--today YYYY-MM-DD] [--http [--port N]]
```

- `<project-root>` is where manifest discovery starts. It comes from the
  command line, never from the process working directory: a harness spawns the
  server from an unpredictable place, and walking up from the wrong one either
  finds no `.agents/okf.yaml` or serves the wrong directory.
- `--bundle` is always required, even where the manifest declares exactly one
  bundle. Naming it fails at startup on a typo instead of failing every later
  tool call.
- `--profile-module` is a trusted consumer module exporting `profile`, resolved
  against the project root. There is no named profile registry.
- `--today` is the date staleness is judged against. It is never defaulted from
  the system clock.

## Transports

stdio is the default, and the reason this server exists. Standard output
carries protocol traffic only; every diagnostic goes to standard error.

```json
{
  "command": "okf-mcp",
  "args": ["/home/you/knowledge-repository", "--bundle", "private"]
}
```

`--http` serves the same surface over loopback HTTP at
`http://127.0.0.1:1934/v1/mcp`. It binds `127.0.0.1` only and rejects any
request whose `Host` or `Origin` is not localhost. Use `--port` to give each
bundle its own port.

## Access

The manifest's `access` field decides what the server will do. A bundle
declaring `read` serves the seven reading tools and refuses
`okf_v1_preview_change` and `okf_v1_apply_change`; `read-write`, or no value at
all, serves all ten. Any other value stops the server at startup rather than
being guessed at.

## Visualization

`okf_v1_visualize` writes the generated page to a temporary directory and
returns its `file:` URL, because a local client opens a file rather than a
route this process serves.
