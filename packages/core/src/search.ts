import type { BundleAnalysis } from "okf-contracts";

import { markdownHeadings } from "./markdown.js";
import { byCodePoint } from "./paths.js";
import type { SearchPassage, SearchResult } from "./types.js";

const TOKEN = /[0-9a-z]+/g;
const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const FRONTMATTER_FIELD = /^(?:title|description)[ \t]*:[ \t]*(.+?)[ \t]*$/gm;
const STOPWORDS = new Set(
  "a an and are as at be by for from how in is it its of on or that the this to was what when where which why with".split(
    " ",
  ),
);
const EMPHASIS_WEIGHT = 3;
const PHRASE_WEIGHT = 8;
const MAX_PASSAGES_PER_DOCUMENT = 3;

function tokenize(text: string): string[] {
  return text.toLowerCase().match(TOKEN) ?? [];
}

function normalize(text: string): string {
  return text.toLowerCase().split(/\s+/).filter(Boolean).join(" ");
}

function counts(tokens: readonly string[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const token of tokens) {
    result.set(token, (result.get(token) ?? 0) + 1);
  }
  return result;
}

export function queryTerms(query: string): readonly string[] {
  const tokens = tokenize(query);
  const meaningful = tokens.filter((token) => !STOPWORDS.has(token));
  return meaningful.length > 0 ? meaningful : tokens;
}

function analyze(text: string, path: string): { emphasis: Map<string, number>; body: Map<string, number> } {
  const emphasisSource = [path.replace(/[/-]/g, " ")];
  let body = text;
  const frontmatter = FRONTMATTER.exec(text);
  if (frontmatter) {
    for (const field of (frontmatter[1] ?? "").matchAll(FRONTMATTER_FIELD)) {
      emphasisSource.push(field[1] ?? "");
    }
    body = text.slice(frontmatter[0].length);
  }
  for (const heading of markdownHeadings(body)) {
    emphasisSource.push(heading.text);
  }
  return { emphasis: counts(tokenize(emphasisSource.join(" "))), body: counts(tokenize(body)) };
}

function passagesFor(
  text: string,
  terms: ReadonlySet<string>,
  phrase: string,
  limit: number,
): readonly { line: number; snippet: string }[] {
  const lines = text.split(/\r?\n/);
  const scored: { weight: number; line: number; snippet: string }[] = [];
  lines.forEach((line, index) => {
    const stripped = line.trim();
    if (!stripped) return;
    const present = new Set(tokenize(stripped));
    let hits = 0;
    for (const term of terms) if (present.has(term)) hits += 1;
    const exact = phrase.length > 0 && normalize(stripped).includes(phrase);
    if (hits > 0 || exact) {
      scored.push({ weight: hits + (exact ? PHRASE_WEIGHT : 0), line: index + 1, snippet: stripped.slice(0, 500) });
    }
  });
  if (scored.length === 0) {
    const first = lines.findIndex((line) => line.trim().length > 0);
    return first < 0 ? [] : [{ line: first + 1, snippet: (lines[first] ?? "").trim().slice(0, 500) }];
  }
  scored.sort((left, right) => right.weight - left.weight || left.line - right.line);
  return scored.slice(0, limit).map(({ line, snippet }) => ({ line, snippet }));
}

export function searchBundle(analysis: BundleAnalysis, query: string, limit = 20): SearchResult {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 20;
  const terms = queryTerms(query);
  const distinct = new Set(terms);
  const phrase = distinct.size > 1 ? normalize(query) : "";
  const entries = analysis.documents.map((document) => ({
    document,
    analysis: analyze(document.content, document.path),
    phraseHits: phrase ? normalize(document.content).split(phrase).length - 1 : 0,
  }));
  const frequency = new Map<string, number>();
  for (const entry of entries) {
    for (const token of new Set([...entry.analysis.emphasis.keys(), ...entry.analysis.body.keys()])) {
      frequency.set(token, (frequency.get(token) ?? 0) + 1);
    }
  }
  const idf = new Map<string, number>();
  for (const term of distinct) {
    idf.set(term, Math.log(1 + entries.length / (1 + (frequency.get(term) ?? 0))));
  }

  const ranked = entries
    .map((entry) => {
      let total = 0;
      let matched = 0;
      for (const term of distinct) {
        const amount =
          (entry.analysis.body.get(term) ?? 0) + EMPHASIS_WEIGHT * (entry.analysis.emphasis.get(term) ?? 0);
        if (amount > 0) {
          matched += 1;
          total += (idf.get(term) ?? 0) * (1 + Math.log(amount));
        }
      }
      const coverage = distinct.size === 0 ? 0 : matched / distinct.size;
      return { ...entry, score: total * coverage * coverage + PHRASE_WEIGHT * entry.phraseHits };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || byCodePoint(left.document.path, right.document.path));

  const matches: SearchPassage[] = [];
  let truncated = false;
  for (const entry of ranked) {
    if (matches.length >= safeLimit) {
      truncated = true;
      break;
    }
    const budget = Math.min(MAX_PASSAGES_PER_DOCUMENT, safeLimit - matches.length);
    for (const passage of passagesFor(entry.document.content, distinct, phrase, budget)) {
      matches.push({
        path: entry.document.path,
        line: passage.line,
        snippet: passage.snippet,
        score: Math.round(entry.score * 10_000) / 10_000,
      });
    }
  }
  return { terms: [...terms], matches, truncated };
}
