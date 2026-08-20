import type {
  AnalyzedDocument,
  BundleGraph,
  Diagnostic,
  DiagnosticGroups,
} from "okf-contracts";

export interface ProfileDiagnostic {
  readonly code: string;
  readonly severity?: "error" | "warning" | "info";
  readonly path: string;
  readonly message: string;
  readonly range?: Diagnostic["range"];
}

export interface ValidationProfileContext {
  readonly okfVersion: string | null;
  readonly documents: readonly AnalyzedDocument[];
  readonly graph: BundleGraph;
  readonly diagnostics: Pick<DiagnosticGroups, "core" | "guidance">;
  readonly today: string | null;
}

export interface ValidationProfile {
  readonly id: string;
  validate(context: ValidationProfileContext): readonly ProfileDiagnostic[];
}

export interface AnalyzeBundleOptions {
  /** Deterministic ISO date used for staleness. Omit rather than consulting the clock. */
  readonly today?: string;
  readonly profile?: ValidationProfile;
}

export interface ParsedDocumentResult {
  readonly document: AnalyzedDocument;
  readonly diagnostics: Pick<DiagnosticGroups, "core" | "guidance">;
}

export interface ParseDocumentOptions {
  readonly knownPaths?: ReadonlySet<string>;
  readonly today?: string;
}

export interface SearchPassage {
  readonly path: string;
  readonly line: number;
  readonly snippet: string;
  readonly score: number;
}

export interface SearchResult {
  readonly terms: readonly string[];
  readonly matches: readonly SearchPassage[];
  readonly truncated: boolean;
}
