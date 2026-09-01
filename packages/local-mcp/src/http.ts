import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import {
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  originValidationResponse,
  type McpServerFactory,
} from "@modelcontextprotocol/server";
import { OKF_V1_MCP_PATH } from "okf-contracts";

import { LOOPBACK_HOST } from "./arguments.js";

export interface ServeHttpOptions {
  /** 0 asks the operating system for an ephemeral port; the handle reports what it got. */
  readonly port: number;
  readonly onerror?: (error: Error) => void;
}

export interface HttpServerHandle {
  readonly server: Server;
  readonly port: number;
  /** The exact endpoint to configure a client with. */
  readonly url: string;
  close(): Promise<void>;
}

/** The exact bytes, so nothing here has to assume the request body is UTF-8 text. */
async function readBody(message: IncomingMessage): Promise<ArrayBuffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of message) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  const merged = Buffer.concat(chunks);
  return merged.buffer.slice(merged.byteOffset, merged.byteOffset + merged.byteLength) as ArrayBuffer;
}

function toRequest(message: IncomingMessage, body: ArrayBuffer, port: number): Request {
  const host = message.headers.host ?? `${LOOPBACK_HOST}:${String(port)}`;
  const url = new URL(message.url ?? "/", `http://${host}`);
  const headers = new Headers();
  for (const [name, value] of Object.entries(message.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else headers.set(name, value);
  }
  const method = message.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  return new Request(url, { method, headers, ...(hasBody ? { body } : {}) });
}

async function send(response: Response, target: ServerResponse): Promise<void> {
  const headers: Record<string, string> = {};
  for (const [name, value] of response.headers) headers[name] = value;
  target.writeHead(response.status, headers);
  if (response.body === null) {
    target.end();
    return;
  }
  // Streamed so a `text/event-stream` exchange reaches the client as it is produced rather
  // than at the end of the response. A client that hangs up mid-stream cancels the reader,
  // so the handler stops producing instead of writing into a dead socket.
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel(); };
  target.once("close", cancel);
  try {
    while (!target.writableEnded) {
      const { done, value } = await reader.read();
      if (done) break;
      target.write(value);
    }
  } finally {
    target.removeListener("close", cancel);
  }
  target.end();
}

/**
 * Serve the MCP surface over loopback HTTP.
 *
 * The listener binds {@link LOOPBACK_HOST} only, and every request is checked against the
 * localhost `Host` and `Origin` allowlists before it reaches the handler: a local server that
 * reads a private corpus must not become reachable from a page the browser happens to load.
 */
export async function serveHttp(
  factory: McpServerFactory,
  options: ServeHttpOptions,
): Promise<HttpServerHandle> {
  const handler = createMcpHandler(factory, {
    ...(options.onerror === undefined ? {} : { onerror: options.onerror }),
  });
  const allowedHosts = localhostAllowedHostnames();
  const allowedOrigins = localhostAllowedOrigins();

  const server = createServer((message, target) => {
    void (async () => {
      try {
        const body = await readBody(message);
        const port = (server.address() as AddressInfo | null)?.port ?? options.port;
        const request = toRequest(message, body, port);
        const refused = hostHeaderValidationResponse(request, allowedHosts)
          ?? originValidationResponse(request, allowedOrigins);
        if (refused) {
          await send(refused, target);
          return;
        }
        if (new URL(request.url).pathname !== OKF_V1_MCP_PATH) {
          target.writeHead(404).end();
          return;
        }
        await send(await handler.fetch(request), target);
      } catch (error) {
        options.onerror?.(error instanceof Error ? error : new Error(String(error)));
        if (!target.headersSent) target.writeHead(500);
        target.end();
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, LOOPBACK_HOST, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const port = (server.address() as AddressInfo).port;
  return {
    server,
    port,
    url: `http://${LOOPBACK_HOST}:${String(port)}${OKF_V1_MCP_PATH}`,
    async close() {
      await handler.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
