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

const REVISION =
  "The opaque revision `okf_v1_read` returned for this document. The write is refused if the document changed since, rather than overwriting another author.";

const changeSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("create"),
    path: z.string().describe("Bundle-relative path of the new document, including its `.md` extension."),
    content: z
      .string()
      .describe("The complete Markdown of the new document, frontmatter included. There is no partial write."),
  }).strict(),
  z.object({
    operation: z.literal("update"),
    path: z.string().describe("Bundle-relative path of the document to replace."),
    content: z
      .string()
      .describe(
        "The complete replacement Markdown, frontmatter included. This replaces the whole document; it is not a patch.",
      ),
    expected_revision: z.string().describe(REVISION),
  }).strict(),
  z.object({
    operation: z.literal("delete"),
    path: z.string().describe("Bundle-relative path of the document to delete."),
    expected_revision: z.string().describe(REVISION),
  }).strict(),
  z.object({
    operation: z.literal("move"),
    from_path: z.string().describe("Bundle-relative path the document currently has."),
    to_path: z.string().describe("Bundle-relative path the document should have. Links to the old path do not follow it."),
    expected_revision: z.string().describe(REVISION),
  }).strict(),
]);

const CHANGE = "One complete change to the Bundle: create, update, delete, or move exactly one document.";

export interface OkfV1Operations {
  context(): Promise<Record<string, unknown>>;
  index(input: { readonly path: string }): Promise<Record<string, unknown>>;
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

/**
 * What a client is told about this deployment before it calls anything. A model that has loaded
 * no skill has only this and the tool schemas to go on, so the Bundle name has to appear in both.
 */
function serverInstructions(bundle: string): string {
  return [
    `This server serves one OKF Knowledge Bundle, named "${bundle}". Pass that name as the`,
    "`bundle` argument of every tool; any other name is refused.",
    "",
    "Call `okf_v1_context` first. It returns the Bundle's own instruction documents, its root",
    "index, and its navigation, and those govern how the Bundle may be read and changed.",
    "",
    "A Concept is one Markdown document, and its Concept ID is its Bundle-relative path without",
    "`.md`. Authored Markdown is the authority; the index, search snippets, inspection output, and",
    "visualization are generated views of it.",
    "",
    "Writing is two steps and never one. `okf_v1_preview_change` returns a diff, the affected",
    "paths, diagnostics, and a `preview_id`. Show all of it, wait for explicit approval, then pass",
    "the unchanged request and that `preview_id` to `okf_v1_apply_change`.",
  ].join("\n");
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
  const server = new McpServer(
    { name: options.name, version: options.version },
    { instructions: serverInstructions(options.bundle) },
  );
  // Built here rather than at module scope so the description can name the Bundle this deployment
  // actually serves. `bundle` stays a plain string: a later deployment may serve a different one.
  const bundleSchema = z.object({
    bundle: z
      .string()
      .describe(
        `The Knowledge Bundle to address. This deployment serves "${options.bundle}"; any other name is refused.`,
      ),
  });
  const directoryPath = z
    .string()
    .default(".")
    .describe(
      'Bundle-relative directory, such as "concepts". Use "." for the Bundle root. This is a path inside the Bundle, not the Bundle name.',
    );
  const documentPath = z
    .string()
    .describe(
      'Bundle-relative path to one document, including its `.md` extension, such as "concepts/prompt-evaluation.md".',
    );
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
    {
      title: "Read OKF context",
      description:
        "Read the Bundle's operating context: its adapter, audience, instruction documents, root index, and generated navigation. Call this before any other OKF tool — the instructions it returns govern how this Bundle may be read and changed.",
      inputSchema: bundleSchema,
      annotations: READ_ONLY,
    },
    async (input) => run(() => { bundleInput(input); return options.operations.context(); }),
  );
  server.registerTool(
    "okf_v1_index",
    {
      title: "Generate directory navigation for one OKF bundle",
      description:
        "Read one directory's generated navigation: its title, its entries, and the Markdown its index page renders. A projection of the current Bundle rather than authored content.",
      inputSchema: bundleSchema.extend({ path: directoryPath }),
      annotations: READ_ONLY,
    },
    async (input) => run(() => options.operations.index(bundleInput(input))),
  );
  server.registerTool(
    "okf_v1_list",
    {
      title: "List OKF paths",
      description:
        "List the paths under one directory, down to a given depth. Use it to see what the Bundle holds; use `okf_v1_read` to open a document.",
      inputSchema: bundleSchema.extend({
        path: directoryPath,
        depth: z
          .number()
          .int()
          .min(0)
          .max(8)
          .default(2)
          .describe("How many directory levels below `path` to walk. 0 lists that directory alone."),
      }),
      annotations: READ_ONLY,
    },
    async (input) => run(() => options.operations.list(bundleInput(input))),
  );
  server.registerTool(
    "okf_v1_search",
    {
      title: "Search one OKF bundle",
      description:
        "Search the Bundle's documents for free text and return ranked matches with snippets. A snippet is evidence for choosing what to open, never a substitute for reading the document.",
      inputSchema: bundleSchema.extend({
        query: z.string().trim().min(1).describe("Free text to look for across the Bundle's documents."),
        limit: z.number().int().min(1).max(100).default(20).describe("Most matches to return."),
      }),
      annotations: READ_ONLY,
    },
    async (input) => run(() => options.operations.search(bundleInput(input))),
  );
  for (const [name, title, description, operation] of [
    [
      "okf_v1_read",
      "Read an OKF document",
      "Read one document: its frontmatter, its body, and its opaque revision. Keep the revision if the document may be changed — a write is refused unless it names the revision it was based on.",
      options.operations.read,
    ],
    [
      "okf_v1_links",
      "Read OKF document links",
      "Read the links into and out of one document, so a Concept's neighbours can be followed without guessing paths.",
      options.operations.links,
    ],
  ] as const) {
    server.registerTool(
      name,
      { title, description, inputSchema: bundleSchema.extend({ path: documentPath }), annotations: READ_ONLY },
      async (input) => run(() => operation.call(options.operations, bundleInput(input))),
    );
  }
  for (const [name, title, description, operation] of [
    [
      "okf_v1_validate",
      "Validate an OKF bundle",
      "Validate the whole Bundle against its profile. An error refuses every write to the Bundle until it clears, including the write that would fix it; a warning blocks nothing.",
      options.operations.validate,
    ],
    [
      "okf_v1_inspect",
      "Inspect an OKF bundle",
      "Summarize the Bundle: how many documents it holds, their types and statuses, and its health signals. A generated view over the current content.",
      options.operations.inspect,
    ],
    [
      "okf_v1_visualize",
      "Locate the OKF visualization",
      "Locate the Bundle's generated graph page. It is a projection rebuilt from the Bundle, never authored content, and must not be edited.",
      options.operations.visualize,
    ],
  ] as const) {
    server.registerTool(
      name,
      { title, description, inputSchema: bundleSchema, annotations: READ_ONLY },
      async (input) => run(() => { bundleInput(input); return operation.call(options.operations); }),
    );
  }
  server.registerTool(
    "okf_v1_preview_change",
    {
      title: "Preview an OKF change",
      description:
        "Check one complete change without writing it. Returns the diff, the affected paths, diagnostics, and a `preview_id`. Show all of it and wait for explicit approval before applying.",
      inputSchema: bundleSchema.extend({ change: changeSchema.describe(CHANGE) }),
      annotations: READ_ONLY,
    },
    async (input) => run(async () => ({ ...await options.operations.previewChange(bundleInput(input).change) })),
  );
  server.registerTool(
    "okf_v1_apply_change",
    {
      title: "Apply a previously reviewed OKF change",
      description:
        "Write a change that `okf_v1_preview_change` already checked. Pass the unchanged request together with the `preview_id` it returned. A changed request, a reused preview, or a stale `expected_revision` is refused.",
      inputSchema: bundleSchema.extend({
        change: changeSchema.describe(CHANGE),
        preview_id: z
          .string()
          .regex(/^sha256:[0-9a-f]{64}$/)
          .describe("The `preview_id` `okf_v1_preview_change` returned for this exact change."),
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
