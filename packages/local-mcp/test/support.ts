import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";

import { createOkfLocalServer, type OkfLocalServerOptions } from "../src/server.js";

/** Fixtures live in the source tree; the compiled tests run two directories below it. */
export function fixture(name: string): string {
  return fileURLToPath(new URL(`../../test/fixtures/${name}`, import.meta.url));
}

/** A throwaway copy, for the tests that write to the bundle. */
export async function fixtureCopy(name: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "okf-mcp-fixture-"));
  const target = path.join(directory, name);
  await cp(fixture(name), target, { recursive: true });
  return target;
}

export interface ConnectedServer {
  readonly client: Client;
  readonly bundle: string;
}

export async function connect(options: OkfLocalServerOptions): Promise<ConnectedServer> {
  const local = await createOkfLocalServer(options);
  const client = new Client({ name: "okf-mcp-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await local.createServer().connect(serverTransport);
  await client.connect(clientTransport);
  return { client, bundle: local.settings.name };
}

export interface ToolOutcome {
  readonly isError: boolean;
  readonly text: string;
}

export async function callTool(
  client: Client,
  name: string,
  arguments_: Record<string, unknown>,
): Promise<ToolOutcome> {
  const result = await client.callTool({ name, arguments: arguments_ }) as {
    isError?: boolean;
    content: { text?: string }[];
  };
  return { isError: result.isError === true, text: result.content[0]?.text ?? "" };
}

/** Call a tool that is expected to succeed and read its JSON payload. */
export async function callJson<T>(
  client: Client,
  name: string,
  arguments_: Record<string, unknown>,
): Promise<T> {
  const outcome = await callTool(client, name, arguments_);
  if (outcome.isError) {
    throw new Error(`${name} failed: ${outcome.text}`);
  }
  return JSON.parse(outcome.text) as T;
}
