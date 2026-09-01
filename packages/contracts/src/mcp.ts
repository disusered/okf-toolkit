import { McpServer } from "@modelcontextprotocol/server";
import type { ApplyChangeRequest, Change, ChangePreview, ChangeResult } from "./index.js";
import * as z from "zod/v4";

export const OKF_V1_MCP_PATH = "/v1/mcp";
export const OKF_V1_VISUALIZATION_PATH = "/v1/viz";

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const WRITING = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const changeSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("create"), path: z.string(), content: z.string() }).strict(),
  z.object({
    operation: z.literal("update"),
    path: z.string(),
    content: z.string(),
    expected_revision: z.string(),
  }).strict(),
  z.object({ operation: z.literal("delete"), path: z.string(), expected_revision: z.string() }).strict(),
  z.object({
    operation: z.literal("move"),
    from_path: z.string(),
    to_path: z.string(),
    expected_revision: z.string(),
  }).strict(),
]);

const bundleSchema = z.object({ bundle: z.string() });

export interface OkfV1Operations {
  context(): Promise<Record<string, unknown>>;
  list(input: { readonly path: string; readonly depth: number }): Promise<Record<string, unknown>>;
  search(input: { readonly query: string; readonly limit: number }): Promise<Record<string, unknown>>;
  read(input: { readonly path: string }): Promise<Record<string, unknown>>;
  links(input: { readonly path: string }): Promise<Record<string, unknown>>;
  validate(): Promise<Record<string, unknown>>;
  inspect(): Promise<Record<string, unknown>>;
  visualize(): Promise<Record<string, unknown>>;
  previewChange(change: Change): Promise<ChangePreview>;
  applyChange(request: ApplyChangeRequest): Promise<ChangeResult>;
}

export interface OkfV1McpOptions {
  readonly name: string;
  readonly version: string;
  readonly bundle: string;
  readonly operations: OkfV1Operations;
}

function success(structuredContent: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "OKF operation failed";
  return { content: [{ type: "text" as const, text: message }], isError: true as const };
}

export function createOkfV1McpServer(options: OkfV1McpOptions): McpServer {
  const server = new McpServer({ name: options.name, version: options.version });
  const bundleInput = <T extends { bundle: string }>(input: T): Omit<T, "bundle"> => {
    if (input.bundle !== options.bundle) throw new Error(`unknown bundle: ${input.bundle}`);
    const { bundle: _bundle, ...rest } = input;
    return rest;
  };
  const run = async (operation: () => Promise<Record<string, unknown>>) => {
    try {
      return success(await operation());
    } catch (error) {
      return failure(error);
    }
  };

  server.registerTool(
    "okf_v1_context",
    { title: "Read OKF context", inputSchema: bundleSchema, annotations: READ_ONLY },
    async (input) => run(() => { bundleInput(input); return options.operations.context(); }),
  );
  server.registerTool(
    "okf_v1_list",
    {
      title: "List OKF paths",
      inputSchema: bundleSchema.extend({ path: z.string().default("."), depth: z.number().int().min(0).max(8).default(2) }),
      annotations: READ_ONLY,
    },
    async (input) => run(() => options.operations.list(bundleInput(input))),
  );
  server.registerTool(
    "okf_v1_search",
    {
      title: "Search one OKF bundle",
      inputSchema: bundleSchema.extend({ query: z.string().trim().min(1), limit: z.number().int().min(1).max(100).default(20) }),
      annotations: READ_ONLY,
    },
    async (input) => run(() => options.operations.search(bundleInput(input))),
  );
  for (const [name, title, operation] of [
    ["okf_v1_read", "Read an OKF document", options.operations.read],
    ["okf_v1_links", "Read OKF document links", options.operations.links],
  ] as const) {
    server.registerTool(
      name,
      { title, inputSchema: bundleSchema.extend({ path: z.string() }), annotations: READ_ONLY },
      async (input) => run(() => operation.call(options.operations, bundleInput(input))),
    );
  }
  for (const [name, title, operation] of [
    ["okf_v1_validate", "Validate an OKF bundle", options.operations.validate],
    ["okf_v1_inspect", "Inspect an OKF bundle", options.operations.inspect],
    ["okf_v1_visualize", "Locate the OKF visualization", options.operations.visualize],
  ] as const) {
    server.registerTool(
      name,
      { title, inputSchema: bundleSchema, annotations: READ_ONLY },
      async (input) => run(() => { bundleInput(input); return operation.call(options.operations); }),
    );
  }
  server.registerTool(
    "okf_v1_preview_change",
    {
      title: "Preview an OKF change",
      inputSchema: bundleSchema.extend({ change: changeSchema }),
      annotations: READ_ONLY,
    },
    async (input) => run(async () => ({ ...await options.operations.previewChange(bundleInput(input).change) })),
  );
  server.registerTool(
    "okf_v1_apply_change",
    {
      title: "Apply a previously reviewed OKF change",
      inputSchema: bundleSchema.extend({
        change: changeSchema,
        preview_id: z.string().regex(/^sha256:[0-9a-f]{64}$/),
      }),
      annotations: WRITING,
    },
    async (input) => run(async () => {
      const { change, preview_id } = bundleInput(input);
      return { ...await options.operations.applyChange({ change, preview_id }) };
    }),
  );

  return server;
}
