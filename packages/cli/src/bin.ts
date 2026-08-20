#!/usr/bin/env node
import { runCli } from "./index.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());

process.exitCode = await runCli(process.argv.slice(2), {
  cwd: process.cwd(),
  readStdin,
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
  signal: controller.signal,
});
