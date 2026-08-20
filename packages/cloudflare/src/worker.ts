import { createMcpHandler } from "@modelcontextprotocol/server";
import type { Change } from "okf-contracts";
import { parseChange } from "okf-core";

import {
  createOkfV1McpServer,
  OKF_V1_MCP_PATH,
  OKF_V1_VISUALIZATION_PATH,
  type OkfV1Operations,
} from "./mcp.js";
import type { R2BucketLike } from "./r2.js";

const REQUIRED_ACCEPT = "application/json, text/event-stream";

function mapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface OkfPrincipal {
  readonly subject: string;
  readonly email?: string;
  readonly claims?: Readonly<Record<string, unknown>>;
}

export interface OkfV1WorkerOptions<Env> {
  readonly name: string;
  readonly version: string;
  readonly bundle: string;
  readonly visualizationKey: string;
  bucket(env: Env): R2BucketLike | null;
  /** Compose Cloudflare Access or another deployment-specific identity policy here. */
  authorize(request: Request, env: Env): Promise<OkfPrincipal | null>;
  canApply(
    principal: OkfPrincipal,
    change: Change | null,
    request: Request,
    env: Env,
  ): Promise<boolean>;
  operations(principal: OkfPrincipal, env: Env): OkfV1Operations;
}

function normalizedAccept(request: Request, body: string): Request {
  const headers = new Headers(request.headers);
  const accept = headers.get("accept") ?? "";
  if (!accept.includes("application/json") || !accept.includes("text/event-stream")) {
    headers.set("accept", REQUIRED_ACCEPT);
  }
  return new Request(request.url, {
    method: request.method,
    headers,
    ...(body.length === 0 ? {} : { body }),
  });
}

function applyChangesOf(body: string): readonly (Change | null)[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  const messages = Array.isArray(parsed) ? parsed : [parsed];
  const changes: (Change | null)[] = [];
  for (const message of messages) {
    if (!mapping(message) || message.method !== "tools/call" || !mapping(message.params)) continue;
    if (message.params.name !== "okf_v1_apply_change") continue;
    const arguments_ = mapping(message.params.arguments) ? message.params.arguments : {};
    try {
      changes.push(parseChange(arguments_.change));
    } catch {
      changes.push(null);
    }
  }
  return changes.length > 0 ? changes : undefined;
}

function refusedApply(body: string): Response {
  let id: unknown = null;
  try {
    const parsed: unknown = JSON.parse(body);
    id = mapping(parsed) ? parsed.id ?? null : null;
  } catch {}
  return Response.json({
    jsonrpc: "2.0",
    id,
    error: { code: -32600, message: "okf_v1_apply_change is not authorized for this caller" },
  });
}

/** Build a fetch handler for exactly one Access-gated bundle. */
export function createOkfV1Worker<Env>(options: OkfV1WorkerOptions<Env>) {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const principal = await options.authorize(request, env);
      if (!principal) return new Response(null, { status: 401 });

      const pathname = new URL(request.url).pathname;
      const bucket = options.bucket(env);
      if (!bucket) return new Response(null, { status: 500 });

      if (pathname === OKF_V1_VISUALIZATION_PATH) {
        if (request.method !== "GET") {
          return new Response(null, { status: 405, headers: { Allow: "GET" } });
        }
        const object = await bucket.get(options.visualizationKey);
        if (!object) return new Response(null, { status: 404 });
        return new Response(object.body ?? await object.text(), {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store, private",
          },
        });
      }

      if (pathname !== OKF_V1_MCP_PATH) return new Response(null, { status: 404 });

      const body = await request.text();
      const changes = applyChangesOf(body);
      if (changes !== undefined) {
        for (const change of changes) {
          if (!await options.canApply(principal, change, request, env)) {
            return refusedApply(body);
          }
        }
      }

      const handler = createMcpHandler(() => createOkfV1McpServer({
        name: options.name,
        version: options.version,
        bundle: options.bundle,
        operations: options.operations(principal, env),
      }));
      return handler.fetch(normalizedAccept(request, body));
    },
  };
}
