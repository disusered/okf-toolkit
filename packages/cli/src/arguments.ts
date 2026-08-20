export interface CliArguments {
  readonly command: string;
  readonly subcommand: string | null;
  readonly positionals: readonly string[];
  readonly bundle?: string;
  readonly profile?: string;
  readonly profileModule?: string;
  readonly previewId?: string;
  readonly out?: string;
  readonly input?: string;
  readonly limit?: number;
  readonly debounce?: number;
  readonly strict: boolean;
  readonly help: boolean;
}

const VALUE_OPTIONS = new Set([
  "--bundle",
  "--profile",
  "--profile-module",
  "--preview-id",
  "--out",
  "--input",
  "--limit",
  "--debounce",
]);

export function parseArguments(argv: readonly string[]): CliArguments {
  if (argv.length === 0) {
    return { command: "help", subcommand: null, positionals: [], strict: false, help: true };
  }
  let command = argv[0]!;
  let subcommand: string | null = null;
  let cursor = 1;
  if (command === "change") {
    subcommand = argv[cursor] ?? null;
    cursor += 1;
  }

  const positionals: string[] = [];
  const options: Record<string, string> = {};
  let help = command === "help";
  let strict = false;
  while (cursor < argv.length) {
    const argument = argv[cursor]!;
    cursor += 1;
    if (argument === "--json") {
      continue;
    }
    if (argument === "--strict") {
      strict = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      help = true;
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

  const integerOption = (name: string): number | undefined => {
    const value = options[name];
    if (value === undefined) {
      return undefined;
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      throw new Error(`${name} must be a positive integer`);
    }
    return parsed;
  };

  const limit = integerOption("--limit");
  const debounce = integerOption("--debounce");

  return {
    command,
    subcommand,
    positionals,
    ...(options["--bundle"] === undefined ? {} : { bundle: options["--bundle"] }),
    ...(options["--profile"] === undefined ? {} : { profile: options["--profile"] }),
    ...(options["--profile-module"] === undefined ? {} : { profileModule: options["--profile-module"] }),
    ...(options["--preview-id"] === undefined ? {} : { previewId: options["--preview-id"] }),
    ...(options["--out"] === undefined ? {} : { out: options["--out"] }),
    ...(options["--input"] === undefined ? {} : { input: options["--input"] }),
    ...(limit === undefined ? {} : { limit }),
    ...(debounce === undefined ? {} : { debounce }),
    strict,
    help,
  };
}
