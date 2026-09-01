/** Loopback only. A local knowledge server has no business listening on another interface. */
export const LOOPBACK_HOST = "127.0.0.1";

/** Overridden with `--port`; three bundles served at once need three ports. */
export const DEFAULT_HTTP_PORT = 1934;

export interface ServerArguments {
  /**
   * The project root to resolve the manifest from. Taken from argv rather than the process
   * cwd: a harness spawns this server from an unpredictable directory, and manifest discovery
   * walking up from the wrong place either fails or serves the wrong directory.
   */
  readonly projectRoot: string;
  readonly bundle: string;
  readonly profileModule?: string;
  /** Deterministic YYYY-MM-DD used for staleness. Never defaulted from the system clock. */
  readonly today?: string;
  readonly http: boolean;
  readonly port: number;
  readonly help: boolean;
}

const VALUE_OPTIONS = new Set(["--bundle", "--profile", "--profile-module", "--today", "--port"]);

const HELP_ARGUMENTS: ServerArguments = {
  projectRoot: ".",
  bundle: "",
  http: false,
  port: DEFAULT_HTTP_PORT,
  help: true,
};

export function parseServerArguments(argv: readonly string[]): ServerArguments {
  if (argv.length === 0) {
    throw new Error("okf-mcp requires a project root and --bundle NAME");
  }

  const positionals: string[] = [];
  const options: Record<string, string> = {};
  let http = false;
  let cursor = 0;
  while (cursor < argv.length) {
    const argument = argv[cursor]!;
    cursor += 1;
    if (argument === "--help" || argument === "-h") {
      return HELP_ARGUMENTS;
    }
    if (argument === "--http") {
      http = true;
      continue;
    }
    if (VALUE_OPTIONS.has(argument)) {
      const value = argv[cursor];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${argument} requires a value`);
      }
      options[argument] = value;
      cursor += 1;
      continue;
    }
    if (argument.startsWith("-")) {
      throw new Error(`unknown option: ${argument}`);
    }
    positionals.push(argument);
  }

  if (options["--profile"] !== undefined) {
    throw new Error(
      "okf-mcp does not support named --profile values; use --profile-module with a trusted consumer module",
    );
  }
  if (positionals.length === 0) {
    throw new Error("okf-mcp requires a project root");
  }
  if (positionals.length > 1) {
    throw new Error("okf-mcp serves exactly one project root");
  }

  // Always required, even where a manifest declares exactly one bundle. Naming it fails at
  // startup on a typo instead of failing every later tool call with `unknown bundle`.
  const bundle = options["--bundle"];
  if (bundle === undefined) {
    throw new Error("okf-mcp requires --bundle NAME");
  }

  const today = options["--today"];
  if (today !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    throw new Error("--today must be a YYYY-MM-DD date");
  }

  const rawPort = options["--port"];
  if (rawPort !== undefined && !http) {
    throw new Error("--port applies to --http only");
  }
  let port = DEFAULT_HTTP_PORT;
  if (rawPort !== undefined) {
    const parsed = Number(rawPort);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65535) {
      throw new Error("--port must be a TCP port between 1 and 65535");
    }
    port = parsed;
  }

  return {
    projectRoot: positionals[0]!,
    bundle,
    ...(options["--profile-module"] === undefined ? {} : { profileModule: options["--profile-module"] }),
    ...(today === undefined ? {} : { today }),
    http,
    port,
    help: false,
  };
}
