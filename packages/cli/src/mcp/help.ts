import { OKF_V1_MCP_PATH } from "okf-contracts";

import { DEFAULT_HTTP_PORT, LOOPBACK_HOST } from "./arguments.js";
import { HEALTH_PATH } from "./http.js";

export const HELP = `okf mcp — serve one filesystem OKF bundle over MCP

Usage:
  okf mcp <project-root> --bundle NAME [options]

Options:
  --bundle NAME           The manifest bundle to serve. Always required.
  --profile-module PATH   Trusted validation profile module, resolved against the
                          project root. It must export \`profile\`.
  --today YYYY-MM-DD      Date staleness is judged against. Never defaulted.
  --http                  Serve loopback HTTP instead of stdio.
  --port N                HTTP port (default ${String(DEFAULT_HTTP_PORT)}). Requires --http.
  --allowed-host HOST     Accept HOST as the Host a tunnel or reverse proxy
                          forwards. Repeatable. Requires --http.
  -h, --help              Print this help.

Identity (what a client shows and a model reads first):
  --name NAME             Server name (default okf-<bundle>).
  --title TEXT            Human-readable title.
  --description TEXT      One or two sentences on what the server holds.
  --website URL           Where a person can learn more.
  --icon URL              Icon a client may show beside the server.
  --purpose TEXT          One sentence that opens the server instructions.

In stdio mode standard output carries protocol traffic only; diagnostics go to
standard error.

With --http the server binds ${LOOPBACK_HOST} only and serves ${OKF_V1_MCP_PATH}, plus
GET ${HEALTH_PATH}. It refuses any Host or Origin that is neither localhost nor an
--allowed-host. Publishing a loopback server is the job of the tunnel or proxy in
front of it, which also authenticates every caller.
`;
