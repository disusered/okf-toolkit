export const HELP = `Usage: okf <command> [target] [options]

Every command operates on exactly one OKF bundle. The CLI writes JSON by
default. Use --json to state that contract explicitly.

Commands:
  context [target]                 Read manifest-scoped instructions
  list [target]                    List analyzed Markdown documents
  search [target] <query...>       Search one bundle
  read [target] <path>             Read one analyzed document
  links [target] [path]            List resolved links
  validate [target]                Emit grouped diagnostics
  inspect [target]                 Emit the okf.inspect.v1 snapshot
  visualize [target] --out FILE    Generate a self-contained HTML viewer
  watch [target] --out FILE        Rebuild the viewer when Markdown changes
  change preview [target] --input FILE|-
  change apply [target] --preview-id ID --input FILE|-

Options:
  --bundle NAME    Select one bundle from .agents/okf.yaml
  --profile-module FILE
                   Load a consumer-owned module exporting profile
  --preview-id ID  Apply the exact canonical change reviewed by preview
  --strict         Make OKF guidance warnings fail validation
  --limit NUMBER   Limit search results
  --out FILE       Visualization output path
  --input FILE|-   JSON change request (default: stdin)
  --debounce MS    Watch debounce in milliseconds
  --json            Explicitly request the default JSON output

The CLI does not support named --profile values. Profiles are consumer-owned;
hosted consumers compose them in code, and local wrappers can pass
--profile-module.
`;
