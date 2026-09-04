import type { Diagnostic, DocumentKind } from "okf-contracts";

import { diagnostic } from "./diagnostics.js";
import { validDate } from "./derive.js";
import type { FrontmatterParseResult } from "./frontmatter.js";
import { blocksFromRoot, headingsFromRoot, type MarkdownRoot } from "./markdown.js";
import { isSafeMarkdownPath } from "./paths.js";

export function documentKind(path: string): DocumentKind {
  const name = path.split("/").at(-1);
  return name === "index.md" ? "index" : name === "log.md" ? "log" : "concept";
}

export function coreDiagnostics(
  path: string,
  kind: DocumentKind,
  parsed: FrontmatterParseResult,
  body: MarkdownRoot,
): readonly Diagnostic[] {
  const result: Diagnostic[] = [];
  if (!isSafeMarkdownPath(path)) {
    result.push(
      diagnostic("core", "error", "core.bundle.path.invalid", path, "document path must be a confined bundle-relative .md path"),
    );
  }

  if (kind === "concept") {
    if (!parsed.hadFrontmatter) {
      result.push(
        diagnostic(
          "core",
          "error",
          "core.concept.frontmatter.missing",
          path,
          "concept must begin with YAML frontmatter",
        ),
      );
      return result;
    }
    if (parsed.error !== null || parsed.snapshot === null) {
      const jsonBoundary = parsed.errorKind === "json";
      result.push(
        diagnostic(
          "core",
          "error",
          jsonBoundary ? "core.concept.frontmatter.non-json" : "core.concept.frontmatter.invalid-yaml",
          path,
          jsonBoundary
            ? `okf.inspect.v1 cannot represent concept frontmatter: ${parsed.error ?? "unknown error"}`
            : `concept frontmatter is not a parseable YAML mapping: ${parsed.error ?? "unknown error"}`,
        ),
      );
      return result;
    }
    const type = parsed.snapshot.metadata["type"];
    if (typeof type !== "string" || !type.trim()) {
      result.push(
        diagnostic("core", "error", "core.concept.type.missing", path, "concept type must be a non-empty string"),
      );
    }
    return result;
  }

  if (parsed.hadFrontmatter && parsed.error !== null) {
    const jsonBoundary = parsed.errorKind === "json";
    result.push(
      diagnostic(
        "core",
        "error",
        jsonBoundary ? `core.${kind}.frontmatter.non-json` : `core.${kind}.frontmatter.invalid-yaml`,
        path,
        jsonBoundary
          ? `okf.inspect.v1 cannot represent ${kind} frontmatter: ${parsed.error}`
          : `${kind} frontmatter is not a parseable YAML mapping: ${parsed.error}`,
      ),
    );
  }

  if (kind === "index") {
    if (path === "index.md") {
      if (parsed.snapshot !== null) {
        const keys = Object.keys(parsed.snapshot.metadata);
        if (keys.some((key) => key !== "okf_version")) {
          result.push(
            diagnostic(
              "core",
              "error",
              "core.index.frontmatter.keys",
              path,
              "root index frontmatter supports only okf_version",
            ),
          );
        }
      }
    } else if (parsed.hadFrontmatter) {
      result.push(
        diagnostic(
          "core",
          "error",
          "core.index.frontmatter.nested",
          path,
          "nested index.md must not contain frontmatter",
        ),
      );
    }
    if (headingsFromRoot(body).length === 0) {
      result.push(
        diagnostic("core", "error", "core.index.heading.missing", path, "index must contain a Markdown heading"),
      );
    }
    return result;
  }

  if (parsed.hadFrontmatter) {
    result.push(
      diagnostic("core", "error", "core.log.frontmatter.forbidden", path, "log.md must not contain frontmatter"),
    );
  }
  const blocks = blocksFromRoot(body);
  const headings = blocks.flatMap((block) => block.type === "heading" ? [block] : []);
  if (headings.length === 0) {
    result.push(diagnostic("core", "error", "core.log.heading.missing", path, "log must contain a Markdown heading"));
  }
  const dateHeadings = headings.filter((heading) => heading.depth === 2);
  if (dateHeadings.length === 0) {
    result.push(
      diagnostic(
        "core",
        "error",
        "core.log.date-group.missing",
        path,
        "log must contain at least one level-two YYYY-MM-DD date group",
      ),
    );
  }
  const validDates: string[] = [];
  for (const heading of dateHeadings) {
    const value = heading.text.trim();
    if (!validDate(value)) {
      result.push(
        diagnostic(
          "core",
          "error",
          "core.log.heading.date",
          path,
          `log date heading must be YYYY-MM-DD: ${value}`,
        ),
      );
    } else {
      validDates.push(value);
    }
  }
  for (const [blockIndex, block] of blocks.entries()) {
    if (block.type !== "heading" || block.depth !== 2) {
      continue;
    }
    let groupEnd = blocks.length;
    for (let candidateIndex = blockIndex + 1; candidateIndex < blocks.length; candidateIndex += 1) {
      const candidate = blocks[candidateIndex]!;
      if (candidate.type === "heading" && candidate.depth === 2) {
        groupEnd = candidateIndex;
        break;
      }
    }
    if (!blocks.slice(blockIndex + 1, groupEnd).some((candidate) => candidate.type === "list")) {
      result.push(
        diagnostic(
          "core",
          "error",
          "core.log.date-group.list",
          path,
          `log date group must contain a top-level list of entries: ${block.text.trim()}`,
        ),
      );
    }
  }
  for (let index = 1; index < validDates.length; index += 1) {
    const previous = validDates[index - 1]!;
    const current = validDates[index]!;
    if (current > previous) {
      result.push(
        diagnostic(
          "core",
          "error",
          "core.log.heading.order",
          path,
          `log date groups must be newest first: ${current} follows ${previous}`,
        ),
      );
      break;
    }
  }
  return result;
}
