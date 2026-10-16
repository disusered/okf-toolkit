# Knowledge front-end baseline

This is how a workspace makes its OKF Bundle available to people and agents. A
workspace adopts it by recording, in its own repository, the values this page
leaves open: its hostname, its identity, its storage, and its infrastructure
repository.

## One front end per workspace

A workspace publishes exactly one HTTPS MCP endpoint for its Bundle. Every agent
uses the same URL, whether it runs on the author's machine or in a vendor's
cloud: Claude (desktop, web, and Claude Code), ChatGPT, Codex, and Pi all
connect to a remote MCP server and sign in with OAuth. A workspace does not keep
a second, local-only connector beside it.

Where the bytes sit does not change the front end. A Bundle in local files and a
Bundle in R2 expose the same `okf_v1_*` tools, with the same write rules.

## Four parts

| Part | Role | Provided by |
|---|---|---|
| Surface | The eleven `okf_v1_*` tools and the server identity | `okf-contracts` `createOkfV1McpServer` |
| Storage | One implementation of `OkfV1Operations` | Filesystem: `@disusered/okf-cli` `createOkfLocalServer` over `okf-node`. R2: `okf-cloudflare` |
| Host | Where the server process runs | Node: `okf mcp --http`, or an application embedding `createOkfLocalServer`. Worker: `okf-cloudflare` `createOkfV1Worker` |
| Edge | Public HTTPS and OAuth sign-in | Cloudflare Access, configured with [`infra/modules/access-mcp-server`](../infra/modules/access-mcp-server/) |

An application that already serves its own tools, such as a personal dashboard,
may embed the surface beside them and remain that workspace's single front end.

## Hosting

| | Node host | Worker host |
|---|---|---|
| Storage | Filesystem | R2 |
| Runs on | A machine the workspace controls, as a service | Cloudflare |
| Listens on | `127.0.0.1` only | The Worker's custom domain |
| Reached through | A Cloudflare Tunnel to the loopback port | The custom domain |
| Availability | While that machine is running | Always |
| Concurrency | One process, one writer | R2 conditional writes |

Start a Node host with the public hostname named, so the loopback listener
accepts the `Host` the tunnel forwards:

```sh
okf mcp /srv/knowledge --bundle team --http --port 1934 \
  --allowed-host knowledge-mcp.example.com \
  --name example-knowledge --title "Example Knowledge" \
  --description "Decisions, policies, and runbooks the team works from." \
  --website https://example.com/knowledge \
  --purpose "Example's shared knowledge: decisions, policies, and runbooks."
```

`GET /healthz` answers on the same port without an MCP session, for a service
manager or a tunnel health check.

## Authentication

Cloudflare Access authenticates every caller, and is the OAuth authorization
server MCP clients discover and register with. The module configures dynamic
client registration, loopback and localhost redirects for desktop and
command-line clients, and redirect URIs for Claude and ChatGPT connectors.

- **Node host:** no authentication code. The listener binds loopback, so the
  only route to it is the tunnel, and the tunnel's hostname is behind Access.
- **Worker host:** verify the Access assertion with
  `accessAuthorizer({ teamDomain, audience })`. A Worker is reachable on the
  edge, and the verified email decides who may apply changes.

Access policy is the allowlist. Keep it to individual addresses; an email-domain
rule admits anyone who ever holds an address at that domain.

## Hostnames

Name each published server `<name>-mcp.<zone>`, one level below the zone apex.
A second level, such as `<name>.mcp.<zone>`, falls outside the zone's universal
certificate and needs a paid one.

## Identity

A client lists servers by name and description, and a model reads the server
instructions before anything else. Give every front end:

- a connector key and server name that say what it holds, such as
  `example-knowledge`, never the name of the software serving it;
- a `title` and a one-to-two sentence `description`;
- a `websiteUrl` and an icon;
- a one-sentence `purpose`, which opens the server instructions.

Every tool keeps its title. Report the deployment's own version, not the
toolkit's.

## Packaging for agents

Ship each front end as one plugin, from a private marketplace the workspace
controls:

```text
<plugin>/
  .claude-plugin/plugin.json   name, displayName, version, description
  .mcp.json                    { "mcpServers": { "<key>": { "type": "http", "url": "https://<name>-mcp.<zone>/mcp" } } }
  skills/<skill>/SKILL.md      how to work with this Bundle
```

Installing the plugin installs the skill and the connector together. Claude and
Codex read the plugin from their marketplaces; Pi takes the URL from the same
`.mcp.json` with `pi mcp add <key> --url <url>` and signs in with
`pi mcp login <key>`; ChatGPT takes the URL as a connector.

## Writes

Every write is two steps. `okf_v1_preview_change` returns the diff, affected
paths, diagnostics, and a preview id. The change is applied only after a person
approves that preview, by passing the unchanged request and the preview id to
`okf_v1_apply_change`. Apply re-checks the document revisions and refuses a
change whose documents moved in the meantime.

## Derived graphs

Analyses and graphs built from a Bundle are projections of its authored
Markdown, not a second authority. Every derived node and edge records the
document revision and passage it came from, so it can be checked and rebuilt.
Content a workspace marks private never enters a general export. New graph
features arrive as operations behind `OkfV1Operations`, so every front end gains
them without a new connector.

## Documentation

Instructions, READMEs, tool descriptions, and decision records describe the
system as it is. They stand alone: a reader needs no conversation, ticket, or
history to understand them.
