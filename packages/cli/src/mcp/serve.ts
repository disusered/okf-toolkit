import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { parseServerArguments } from "./arguments.js";
import { HELP } from "./help.js";
import { serveHttp } from "./http.js";
import { createOkfLocalServer } from "./server.js";

/**
 * Diagnostics never touch standard output. In stdio mode that stream is the protocol, and
 * one stray line of prose ends the session.
 */
function note(message: string): void {
  process.stderr.write(`okf mcp: ${message}\n`);
}

/** `okf mcp`: serve one filesystem bundle over stdio, or loopback HTTP with `--http`. */
export async function runMcp(argv: readonly string[]): Promise<number> {
  let arguments_;
  try {
    arguments_ = parseServerArguments(argv);
  } catch (error) {
    note(error instanceof Error ? error.message : String(error));
    return 2;
  }
  if (arguments_.help) {
    process.stdout.write(HELP);
    return 0;
  }

  let local;
  try {
    local = await createOkfLocalServer({
      projectRoot: arguments_.projectRoot,
      bundle: arguments_.bundle,
      ...(arguments_.profileModule === undefined ? {} : { profileModule: arguments_.profileModule }),
      ...(arguments_.today === undefined ? {} : { today: arguments_.today }),
      ...(arguments_.name === undefined ? {} : { name: arguments_.name }),
      identity: {
        ...(arguments_.title === undefined ? {} : { title: arguments_.title }),
        ...(arguments_.description === undefined ? {} : { description: arguments_.description }),
        ...(arguments_.website === undefined ? {} : { websiteUrl: arguments_.website }),
        ...(arguments_.icon === undefined ? {} : { icons: [{ src: arguments_.icon }] }),
        ...(arguments_.purpose === undefined ? {} : { purpose: arguments_.purpose }),
      },
      cwd: process.cwd(),
    });
  } catch (error) {
    note(error instanceof Error ? error.message : String(error));
    return 2;
  }

  const factory = () => local.createServer();
  const served = `bundle ${local.settings.name} (${local.settings.access}) from ${local.target.bundle.root}`;
  if (arguments_.http) {
    const handle = await serveHttp(factory, {
      port: arguments_.port,
      allowedHosts: arguments_.allowedHosts,
      service: arguments_.name ?? `okf-${local.settings.name}`,
      onerror: (error) => note(error.message),
    });
    note(`serving ${served} at ${handle.url}`);
  } else {
    serveStdio(factory, { onerror: (error) => note(error.message) });
    note(`serving ${served} over stdio`);
  }
  return 0;
}

