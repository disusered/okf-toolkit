#!/usr/bin/env node
import { runCli } from "./index.js";
import { runMcp } from "./mcp/serve.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function runCommand(argv: readonly string[]): Promise<number> {
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());
  return await runCli(argv, {
    cwd: process.cwd(),
    readStdin,
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
    signal: controller.signal,
  });
}

const argv = process.argv.slice(2);

// `mcp` is a long-running server, not a JSON command: it owns stdio and keeps the default
// signal behavior, so a client or service manager that sends SIGTERM stops it.
process.exitCode = argv[0] === "mcp" ? await runMcp(argv.slice(1)) : await runCommand(argv);
