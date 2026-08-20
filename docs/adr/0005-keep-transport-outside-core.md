# Keep storage and transport outside the core

`okf-core` is a pure, storage-neutral implementation over one in-memory
Bundle. `okf-node` implements confined filesystem behavior, `okf-cloudflare`
implements R2 and MCP behavior, and Consumers define authentication and
deployment policy.
Local CLI and hosted MCP operations therefore use the same rules without
requiring a local server.
