import { OKF_V1_MCP_PATH } from "okf-contracts";

import { DEFAULT_HTTP_PORT, LOOPBACK_HOST } from "./arguments.js";

export const HELP = `okf-mcp — serve one filesystem OKF bundle over MCP

Usage:
  okf-mcp <project-root> --bundle NAME [options]

Options:
  --bundle NAME           The manifest bundle to serve. Always required.
  --profile-module PATH   Trusted validation profile module, resolved against the
                          project root. It must export \`profile\`.
  --today YYYY-MM-DD      Date staleness is judged against. Never defaulted.
  --http                  Serve loopback HTTP instead of stdio.
  --port N                HTTP port (default ${String(DEFAULT_HTTP_PORT)}). Requires --http.
  -h, --help              Print this help.

stdio is the default transport and the reason this server exists. In stdio mode
standard output carries protocol traffic only; diagnostics go to standard error.

With --http the server binds ${LOOPBACK_HOST} only and serves ${OKF_V1_MCP_PATH}.
`;
