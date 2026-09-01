#!/usr/bin/env node
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
  process.stderr.write(`okf-mcp: ${message}\n`);
}

async function main(): Promise<number> {
  let arguments_;
  try {
    arguments_ = parseServerArguments(process.argv.slice(2));
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
      onerror: (error) => note(error.message),
    });
    note(`serving ${served} at ${handle.url}`);
  } else {
    serveStdio(factory, { onerror: (error) => note(error.message) });
    note(`serving ${served} over stdio`);
  }
  return 0;
}

process.exitCode = await main();
