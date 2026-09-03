import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BundleAnalysis } from "okf-contracts";
import { searchBundle, type AnalyzeBundleOptions } from "okf-core";
import {
  applyChange,
  loadValidationProfile,
  parseChange,
  previewChange,
  readBundleContext,
  resolveBundleTarget,
  watchBundle,
  type ResolvedBundleTarget,
} from "okf-node";
import { generateVisualization } from "okf-page";
import { parseArguments, type CliArguments } from "./arguments.js";
import { HELP } from "./help.js";
import { stableJson } from "./json.js";

export interface CliIo {
  readonly cwd: string;
  readonly readStdin: () => Promise<string>;
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
  readonly signal?: AbortSignal;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function targetAndRest(arguments_: CliArguments, minimumRest = 0): { target: string; rest: string[] } {
  const values = [...arguments_.positionals];
  if (values.length <= minimumRest) {
    return { target: ".", rest: values };
  }
  return { target: values.shift()!, rest: values };
}

async function analyzeOptions(arguments_: CliArguments, io: CliIo): Promise<AnalyzeBundleOptions> {
  if (arguments_.profile !== undefined) {
    throw new Error("The CLI does not support named --profile values; use --profile-module with a trusted consumer module");
  }
  const today = arguments_.today === undefined ? {} : { today: arguments_.today };
  if (arguments_.profileModule === undefined) {
    return today;
  }
  return { ...today, profile: await loadValidationProfile(io.cwd, arguments_.profileModule) };
}

async function resolve(arguments_: CliArguments, io: CliIo, minimumRest = 0): Promise<{ target: ResolvedBundleTarget; rest: string[] }> {
  const values = targetAndRest(arguments_, minimumRest);
  return {
    target: await resolveBundleTarget(path.resolve(io.cwd, values.target), arguments_.bundle),
    rest: values.rest,
  };
}

async function readChangeInput(arguments_: CliArguments, io: CliIo): Promise<unknown> {
  const input = arguments_.input ?? "-";
  const text = input === "-" ? await io.readStdin() : await readFile(path.resolve(io.cwd, input), "utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`change input is not valid JSON: ${errorMessage(error)}`);
  }
}

async function runContext(arguments_: CliArguments, io: CliIo): Promise<number> {
  const { target, rest } = await resolve(arguments_, io);
  if (rest.length > 0) {
    throw new Error("context accepts at most one target");
  }
  io.stdout(stableJson({
    schema: "okf.context.v1",
    bundle: { name: target.name },
    documents: await readBundleContext(target),
  }));
  return 0;
}

async function runList(arguments_: CliArguments, io: CliIo): Promise<number> {
  const { target, rest } = await resolve(arguments_, io);
  if (rest.length > 0) {
    throw new Error("list accepts at most one target");
  }
  const analysis = await target.bundle.analyze(await analyzeOptions(arguments_, io));
  io.stdout(stableJson({
    schema: "okf.list.v1",
    documents: analysis.documents.map((document) => ({
      path: document.path,
      id: document.id,
      kind: document.kind,
      revision: document.revision,
      title: document.derived.title,
      type: document.derived.type,
      description: document.derived.description,
      status: document.derived.status,
      trustTier: document.derived.trustTier,
    })),
  }));
  return 0;
}

async function runSearch(arguments_: CliArguments, io: CliIo): Promise<number> {
  const { target, rest } = await resolve(arguments_, io, 1);
  if (rest.length === 0) {
    throw new Error("search requires a query");
  }
  const analysis = await target.bundle.analyze(await analyzeOptions(arguments_, io));
  io.stdout(stableJson({
    schema: "okf.search.v1",
    ...searchBundle(analysis, rest.join(" "), arguments_.limit),
  }));
  return 0;
}

async function runRead(arguments_: CliArguments, io: CliIo): Promise<number> {
  const { target, rest } = await resolve(arguments_, io, 1);
  if (rest.length !== 1) {
    throw new Error("read requires exactly one bundle-relative document path");
  }
  const analysis = await target.bundle.analyze(await analyzeOptions(arguments_, io));
  const document = analysis.documents.find((candidate) => candidate.path === rest[0]);
  if (document === undefined) {
    throw new Error(`document not found: ${rest[0]}`);
  }
  io.stdout(stableJson({ schema: "okf.read.v1", document }));
  return 0;
}

async function runLinks(arguments_: CliArguments, io: CliIo): Promise<number> {
  const { target, rest } = await resolve(arguments_, io);
  if (rest.length > 1) {
    throw new Error("links accepts at most one document path after the target");
  }
  const analysis = await target.bundle.analyze(await analyzeOptions(arguments_, io));
  const documents = rest.length === 0
    ? analysis.documents
    : analysis.documents.filter((document) => document.path === rest[0]);
  if (rest.length === 1 && documents.length === 0) {
    throw new Error(`document not found: ${rest[0]}`);
  }
  io.stdout(stableJson({
    schema: "okf.links.v1",
    links: documents.flatMap((document) => document.links.map((link) => ({ source: document.path, ...link }))),
  }));
  return 0;
}

async function runValidate(arguments_: CliArguments, io: CliIo): Promise<number> {
  const { target, rest } = await resolve(arguments_, io);
  if (rest.length > 0) {
    throw new Error("validate accepts at most one target");
  }
  const analysis = await target.bundle.analyze(await analyzeOptions(arguments_, io));
  const strictFailure = arguments_.strict
    && analysis.diagnostics.guidance.some((diagnostic) => diagnostic.severity === "warning");
  io.stdout(stableJson({
    schema: "okf.validate.v1",
    passed: analysis.summary.errors === 0 && !strictFailure,
    strict: arguments_.strict,
    summary: analysis.summary,
    diagnostics: analysis.diagnostics,
  }));
  return analysis.summary.errors === 0 && !strictFailure ? 0 : 1;
}

async function runInspect(arguments_: CliArguments, io: CliIo): Promise<number> {
  const { target, rest } = await resolve(arguments_, io);
  if (rest.length > 0) {
    throw new Error("inspect accepts at most one target");
  }
  io.stdout(stableJson(await target.bundle.analyze(await analyzeOptions(arguments_, io))));
  return 0;
}

async function writeVisualization(arguments_: CliArguments, io: CliIo): Promise<{ output: string; analysis: BundleAnalysis; target: ResolvedBundleTarget }> {
  if (arguments_.out === undefined) {
    throw new Error("visualize and watch require --out FILE");
  }
  const { target, rest } = await resolve(arguments_, io);
  if (rest.length > 0) {
    throw new Error("visualize and watch accept at most one target");
  }
  const analysis = await target.bundle.analyze(await analyzeOptions(arguments_, io));
  const output = path.resolve(io.cwd, arguments_.out);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, generateVisualization({
    bundle: target.name ?? path.basename(target.bundle.root),
    analysis,
    // Explicit only. Never default to the system clock, or `okf visualize` stops being
    // reproducible for every consumer that does not pass the flag.
    evaluatedAt: arguments_.today ?? null,
  }), "utf8");
  return { output, analysis, target };
}

async function runVisualize(arguments_: CliArguments, io: CliIo): Promise<number> {
  const result = await writeVisualization(arguments_, io);
  io.stdout(stableJson({
    schema: "okf.visualize.v1",
    output: path.relative(io.cwd, result.output) || path.basename(result.output),
    summary: result.analysis.summary,
  }));
  return 0;
}

async function runWatch(arguments_: CliArguments, io: CliIo): Promise<number> {
  const initial = await writeVisualization(arguments_, io);
  io.stdout(stableJson({
    schema: "okf.watch.v1",
    changed: [],
    output: path.relative(io.cwd, initial.output) || path.basename(initial.output),
    summary: initial.analysis.summary,
  }));
  watchBundle(initial.target.bundle, async (event) => {
    await writeFile(
      initial.output,
      generateVisualization({
        bundle: initial.target.name ?? path.basename(initial.target.bundle.root),
        analysis: event.analysis,
        evaluatedAt: arguments_.today ?? null,
      }),
      "utf8",
    );
    io.stdout(stableJson({
      schema: event.schema,
      changed: event.changed,
      output: path.relative(io.cwd, initial.output) || path.basename(initial.output),
      summary: event.analysis.summary,
    }));
  }, {
    debounceMs: arguments_.debounce,
    analyze: await analyzeOptions(arguments_, io),
    signal: io.signal,
  });
  await new Promise<void>((resolvePromise) => {
    if (io.signal?.aborted === true) {
      resolvePromise();
    } else {
      io.signal?.addEventListener("abort", () => resolvePromise(), { once: true });
    }
  });
  return 0;
}

async function runChange(arguments_: CliArguments, io: CliIo): Promise<number> {
  if (arguments_.subcommand !== "preview" && arguments_.subcommand !== "apply") {
    throw new Error("change requires a preview or apply subcommand");
  }
  const { target, rest } = await resolve(arguments_, io);
  if (rest.length > 0) {
    throw new Error("change accepts at most one target");
  }
  const change = parseChange(await readChangeInput(arguments_, io));
  const options = await analyzeOptions(arguments_, io);
  if (arguments_.subcommand === "preview") {
    if (arguments_.previewId !== undefined) {
      throw new Error("Use --preview-id only with change apply");
    }
    const preview = await previewChange(target.bundle, change, options);
    io.stdout(stableJson(preview));
    return preview.passed ? 0 : 1;
  }
  if (arguments_.previewId === undefined) {
    throw new Error("change apply requires --preview-id from change preview");
  }
  const result = await applyChange(target.bundle, {
    change,
    preview_id: arguments_.previewId,
  }, options);
  io.stdout(stableJson(result));
  return result.outcome === "rejected" ? 1 : 0;
}

export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  try {
    const arguments_ = parseArguments(argv);
    if (arguments_.help) {
      io.stdout(HELP);
      return 0;
    }
    switch (arguments_.command) {
      case "context": return await runContext(arguments_, io);
      case "list": return await runList(arguments_, io);
      case "search": return await runSearch(arguments_, io);
      case "read": return await runRead(arguments_, io);
      case "links": return await runLinks(arguments_, io);
      case "validate": return await runValidate(arguments_, io);
      case "inspect": return await runInspect(arguments_, io);
      case "visualize": return await runVisualize(arguments_, io);
      case "watch": return await runWatch(arguments_, io);
      case "change": return await runChange(arguments_, io);
      default: throw new Error(`unknown command: ${arguments_.command}`);
    }
  } catch (error) {
    io.stderr(stableJson({
      schema: "okf.error.v1",
      error: {
        code: typeof error === "object" && error !== null && "code" in error ? String(error.code) : "OKF_CLI_ERROR",
        message: error instanceof Error ? error.message : String(error),
      },
    }));
    return 2;
  }
}

export { parseArguments } from "./arguments.js";
export { stableJson } from "./json.js";
