/**
 * Small pieces every Worker in front of an MCP surface needs, so a deployment composes them
 * instead of keeping its own copy.
 */

export type EnvLike = Readonly<Record<string, unknown>>;

/** A deployment setting is missing or unusable. Raised at the first request, never per call. */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

/** Read one required string setting, trimmed. Empty counts as missing. */
export function requiredEnv(env: EnvLike, name: string): string {
  const value = env[name];
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length === 0) throw new ConfigurationError(`${name} is required`);
  return trimmed;
}

/** The liveness route every deployment serves. */
export const HEALTH_PATH = "/healthz";

export interface HealthOptions {
  readonly service: string;
  readonly version: string;
}

/** `GET /healthz`: `{status, service, version}`. Any other method gets 405. */
export function healthResponse(request: Request, options: HealthOptions): Response {
  if (request.method !== "GET") {
    return new Response(null, { status: 405, headers: { Allow: "GET" } });
  }
  return Response.json(
    { status: "ok", service: options.service, version: options.version },
    { headers: { "cache-control": "no-store" } },
  );
}

/**
 * One structured error line for Workers Logs. It names the event and the error's class only:
 * messages can carry request content, so they never reach the log.
 */
export function logError(event: string, error: unknown): void {
  console.error(JSON.stringify({
    severity: "ERROR",
    event,
    error: error instanceof Error ? error.name : "UnknownError",
  }));
}

export const MCP_ACCEPT = "application/json, text/event-stream";

/**
 * Widen a streamable-HTTP request's `Accept` to what the transport requires.
 *
 * The transport answers 406 unless `Accept` names both `application/json` and
 * `text/event-stream`, and some MCP gateways send only one. Widening the header on the way in
 * keeps those clients working without loosening the transport itself.
 */
export function withMcpAccept(request: Request, body?: string): Request {
  const accept = request.headers.get("accept") ?? "";
  if (body === undefined && accept.includes("application/json") && accept.includes("text/event-stream")) {
    return request;
  }
  const headers = new Headers(request.headers);
  if (!accept.includes("application/json") || !accept.includes("text/event-stream")) {
    headers.set("accept", MCP_ACCEPT);
  }
  if (body === undefined) return new Request(request, { headers });
  return new Request(request.url, {
    method: request.method,
    headers,
    ...(body.length === 0 ? {} : { body }),
  });
}
