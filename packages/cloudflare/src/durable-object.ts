import type {
  ApplyChangeRequest,
  ChangeResult,
  Diagnostic,
  SourcePosition,
  SourceRange,
} from "okf-contracts";
import { OPERATIONS_SCHEMA } from "okf-contracts";
import { byCodePoint, parseChange } from "okf-core";
import type { OkfV1Operations } from "okf-contracts";

export const OKF_V1_DURABLE_APPLY_PATH = "/v1/apply-change";

export interface DurableObjectStubLike {
  fetch(request: Request): Promise<Response>;
}

export interface ApplyChangeDurableObjectOptions<Env> {
  /** Runs inside the bundle's Durable Object after its per-instance apply queue is acquired. */
  apply(request: ApplyChangeRequest, env: Env): Promise<ChangeResult>;
}

export interface ApplyChangeDurableObjectLike {
  fetch(request: Request): Promise<Response>;
}

export interface ApplyChangeDurableObjectConstructor<Env> {
  new(state: unknown, env: Env): ApplyChangeDurableObjectLike;
}

function mapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sourcePosition(value: unknown): value is SourcePosition {
  return mapping(value)
    && typeof value.line === "number"
    && Number.isInteger(value.line)
    && value.line >= 1
    && typeof value.column === "number"
    && Number.isInteger(value.column)
    && value.column >= 1
    && typeof value.offset === "number"
    && Number.isInteger(value.offset)
    && value.offset >= 0;
}

function sourceRange(value: unknown): value is SourceRange {
  return mapping(value) && sourcePosition(value.start) && sourcePosition(value.end);
}

function diagnostic(value: unknown): value is Diagnostic {
  return mapping(value)
    && typeof value.code === "string"
    && (value.family === "core" || value.family === "guidance" || value.family === "profile")
    && (value.severity === "error" || value.severity === "warning" || value.severity === "info")
    && typeof value.path === "string"
    && typeof value.message === "string"
    && (value.profile === undefined || typeof value.profile === "string")
    && (value.range === undefined || sourceRange(value.range));
}

function changeResult(value: unknown): value is ChangeResult {
  return mapping(value)
    && value.schema === OPERATIONS_SCHEMA
    && (value.outcome === "applied" || value.outcome === "unchanged" || value.outcome === "rejected")
    && (value.operation === "create" || value.operation === "update" || value.operation === "delete" || value.operation === "move")
    && mapping(value.revisions)
    && Object.values(value.revisions).every((revision) => revision === null || typeof revision === "string")
    && Array.isArray(value.diagnostics)
    && value.diagnostics.every(diagnostic);
}

function parseApplyChangeRequest(value: unknown): ApplyChangeRequest {
  if (!mapping(value)) {
    throw new Error("apply request must be an object");
  }
  const keys = Object.keys(value).sort(byCodePoint);
  if (keys.length !== 2 || keys[0] !== "change" || keys[1] !== "preview_id") {
    throw new Error("apply request must contain exactly change and preview_id");
  }
  if (typeof value["preview_id"] !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value["preview_id"])) {
    throw new Error("apply request preview_id must be a lowercase SHA-256 identifier");
  }
  return { change: parseChange(value["change"]), preview_id: value["preview_id"] };
}

function errorResponse(error: unknown, status: number): Response {
  return Response.json(
    { error: error instanceof Error ? error.message : "serialized apply failed" },
    { status },
  );
}

/**
 * Return a Cloudflare Durable Object class that serializes every apply for one object instance.
 * Consumers must route every writer for a Bundle through the same name from
 * `durableObjectNameForBundle`.
 */
export function createApplyChangeDurableObject<Env>(
  options: ApplyChangeDurableObjectOptions<Env>,
): ApplyChangeDurableObjectConstructor<Env> {
  return class OkfApplyChangeDurableObject {
    private tail: Promise<void> = Promise.resolve();

    constructor(_state: unknown, private readonly env: Env) {}

    private serialize<T>(operation: () => Promise<T>): Promise<T> {
      const running = this.tail.then(operation, operation);
      this.tail = running.then(() => undefined, () => undefined);
      return running;
    }

    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname !== OKF_V1_DURABLE_APPLY_PATH) return new Response(null, { status: 404 });
      if (request.method !== "POST") {
        return new Response(null, { status: 405, headers: { Allow: "POST" } });
      }

      let applyRequest: ApplyChangeRequest;
      try {
        applyRequest = parseApplyChangeRequest(await request.json());
      } catch (error) {
        return errorResponse(error, 400);
      }

      try {
        return Response.json(await this.serialize(() => options.apply(applyRequest, this.env)));
      } catch (error) {
        return errorResponse(error, 500);
      }
    }
  };
}

export function durableObjectNameForBundle(bundle: string): string {
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(bundle)) {
    throw new Error("bundle must be a stable lowercase identifier");
  }
  return `okf-v1:${bundle}`;
}

export function durableObjectStubForBundle<Id, Stub extends DurableObjectStubLike>(
  namespace: { idFromName(name: string): Id; get(id: Id): Stub },
  bundle: string,
): Stub {
  return namespace.get(namespace.idFromName(durableObjectNameForBundle(bundle)));
}

export function createDurableObjectApplyClient(
  stub: DurableObjectStubLike,
): OkfV1Operations["applyChange"] {
  return async (request) => {
    const response = await stub.fetch(new Request(`https://okf.internal${OKF_V1_DURABLE_APPLY_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    }));
    if (!response.ok) {
      let message = `serialized apply failed with HTTP ${response.status}`;
      try {
        const body: unknown = await response.json();
        if (mapping(body) && typeof body.error === "string") message = body.error;
      } catch {}
      throw new Error(message);
    }
    const result: unknown = await response.json();
    if (!mapping(result) || result.schema !== OPERATIONS_SCHEMA) {
      throw new Error("serialized apply returned an incompatible operations schema");
    }
    if (!changeResult(result)) {
      throw new Error("serialized apply returned an invalid change result");
    }
    return result;
  };
}

/** Replace only mutation dispatch; every read and preview operation stays on the base adapter. */
export function withDurableObjectApply(
  operations: OkfV1Operations,
  stub: DurableObjectStubLike,
): OkfV1Operations {
  return { ...operations, applyChange: createDurableObjectApplyClient(stub) };
}
