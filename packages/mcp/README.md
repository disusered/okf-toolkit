# okf-mcp

`okf-mcp` builds the versioned `okf_v1_*` MCP tool surface for exactly one OKF
Bundle. It declares the tool names, input schemas, and read-only or writing
annotations, refuses any Bundle except the one the deployment configured, and
serializes every result as both text and structured content.

The package holds no transport and no storage. It depends on
`@modelcontextprotocol/server`, `okf-contracts`, and `zod` only, so the same
surface can be served over a Worker fetch handler, a local stdio server, or an
in-memory transport in a test.

```ts
import { createOkfV1McpServer, type OkfV1Operations } from "okf-mcp";

const server = createOkfV1McpServer({
  name: "okf-shared",
  version: "1.0.0",
  bundle: "shared",
  operations,
});
```

You supply the `OkfV1Operations` implementation. `okf-cloudflare` provides an R2
one; a local server can provide a filesystem one built on `okf-node`. The
surface calls an operation only after it has checked the requested Bundle name,
and it turns a thrown error into an MCP tool error rather than a transport
failure.

`OKF_V1_MCP_PATH` and `OKF_V1_VISUALIZATION_PATH` are the versioned routes an
HTTP deployment serves. A transport that has no routes, such as stdio, ignores
them.
