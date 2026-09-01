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
  /**
   * The bundle files that are not OKF documents: the query an Attested Computation runs, the
   * script its attester executes. The analysis never opens them, it only needs to know they
   * exist so a contract path that names one resolves. Paths take the same shape as
   * `AnalyzedDocument.path` — bundle-root-relative, forward slashes — so the two sets compare
   * directly. Omit it and only loaded documents are known, which is the previous behaviour.
   */
  readonly nonDocumentPaths?: ReadonlySet<string>;
  readonly profile?: ValidationProfile;
}

export interface ParsedDocumentResult {
  readonly document: AnalyzedDocument;
  readonly diagnostics: Pick<DiagnosticGroups, "core" | "guidance">;
}

export interface ParseDocumentOptions {
  readonly knownPaths?: ReadonlySet<string>;
  /** Bundle files that are not documents; see `AnalyzeBundleOptions.nonDocumentPaths`. */
  readonly nonDocumentPaths?: ReadonlySet<string>;
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
