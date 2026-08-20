export const OKF_VERSION = "0.2";
export const INSPECT_SCHEMA = "okf.inspect.v1";
export const OPERATIONS_SCHEMA = "okf.operations.v1";

/** Opaque storage token. Callers retain, echo, and compare it without interpreting it. */
export type Revision = string;

/** Exact UTF-8 text read from one bundle-relative Markdown path. */
export interface RawBundleDocument {
  readonly path: string;
  readonly content: string;
  readonly revision?: Revision;
}

export type DocumentKind = "concept" | "index" | "log";
export type DiagnosticFamily = "core" | "guidance" | "profile";
export type DiagnosticSeverity = "error" | "warning" | "info";
export type TrustTier = "unverified" | "machine-confirmed" | "human-reviewed";

export interface SourcePosition {
  readonly line: number;
  readonly column: number;
  readonly offset: number;
}

export interface SourceRange {
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

export interface Diagnostic {
  readonly code: string;
  readonly family: DiagnosticFamily;
  readonly severity: DiagnosticSeverity;
  readonly path: string;
  readonly message: string;
  readonly range?: SourceRange;
  readonly profile?: string;
}

export interface DiagnosticGroups {
  readonly core: readonly Diagnostic[];
  readonly guidance: readonly Diagnostic[];
  readonly profile: readonly Diagnostic[];
}

export type LinkKind = "internal" | "external" | "fragment" | "escape" | "invalid";

export interface AnalyzedLink {
  /** Destination exactly as authored, excluding an optional Markdown title. */
  readonly href: string;
  readonly text: string;
  readonly kind: LinkKind;
  readonly resolvedPath: string | null;
  readonly fragment: string | null;
  readonly exists: boolean | null;
  readonly range: SourceRange | null;
}

export interface AnalyzedSource {
  readonly id: string | null;
  readonly resource: string;
  readonly title: string | null;
  readonly author: string | null;
  readonly usageCount: number | null;
  readonly lastModified: string | null;
  readonly resolvedPath: string | null;
  readonly exists: boolean | null;
}

/** Values that cross the versioned JSON wire boundary without coercion. */
export type JsonValue = null | boolean | number | string | JsonObject | readonly JsonValue[];

/** A JSON object with open extension keys. */
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface FrontmatterSnapshot {
  /** Exact frontmatter block including delimiters and the following line break. */
  readonly raw: string;
  /** Exact text between the delimiters. */
  readonly yaml: string;
  /** JSON-safe projection of the YAML 1.2 mapping, including every extension key. */
  readonly metadata: JsonObject;
}

export interface DerivedDocumentFields {
  readonly title: string;
  readonly type: string | null;
  readonly description: string | null;
  readonly status: string;
  readonly trustTier: TrustTier;
  /** Null when no deterministic `today` was supplied or `stale_after` is absent. */
  readonly stale: boolean | null;
  readonly staleAfter: string | null;
  readonly tags: readonly string[];
  readonly sources: readonly AnalyzedSource[];
}

export interface AnalyzedDocument {
  readonly path: string;
  /** Concept path without `.md`; null for reserved index and log documents. */
  readonly id: string | null;
  readonly kind: DocumentKind;
  readonly revision: Revision | null;
  readonly content: string;
  readonly body: string;
  readonly bodyStartLine: number;
  readonly frontmatter: FrontmatterSnapshot | null;
  /** Alias of JSON-safe frontmatter metadata, or an empty mapping after a parse failure. */
  readonly metadata: JsonObject;
  readonly links: readonly AnalyzedLink[];
  readonly derived: DerivedDocumentFields;
}

export interface BundleGraphNode {
  /** Bundle-relative Markdown path; graph identity never depends on a title. */
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly type: string;
  readonly description: string | null;
  readonly status: string;
  readonly trustTier: TrustTier;
  readonly stale: boolean | null;
  readonly tags: readonly string[];
}

export interface BundleGraphEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly relation: "link" | "source";
}

export interface BundleGraph {
  readonly nodes: readonly BundleGraphNode[];
  readonly edges: readonly BundleGraphEdge[];
}

export interface BundleSummary {
  readonly documents: number;
  readonly concepts: number;
  readonly indexes: number;
  readonly logs: number;
  readonly errors: number;
  readonly warnings: number;
}

/** Stable, transport-neutral full-bundle snapshot emitted by `okf inspect`. */
export interface BundleAnalysis {
  readonly schema: typeof INSPECT_SCHEMA;
  readonly okfVersion: string | null;
  readonly documents: readonly AnalyzedDocument[];
  readonly graph: BundleGraph;
  readonly diagnostics: DiagnosticGroups;
  readonly summary: BundleSummary;
}

export type Change =
  | { readonly operation: "create"; readonly path: string; readonly content: string }
  | {
      readonly operation: "update";
      readonly path: string;
      readonly content: string;
      readonly expected_revision: Revision;
    }
  | {
      readonly operation: "delete";
      readonly path: string;
      readonly expected_revision: Revision;
    }
  | {
      readonly operation: "move";
      readonly from_path: string;
      readonly to_path: string;
      readonly expected_revision: Revision;
    };

/** Apply exactly the change previously reviewed under `preview_id`. */
export interface ApplyChangeRequest {
  readonly change: Change;
  readonly preview_id: string;
}

export interface ChangePreview {
  readonly schema: typeof OPERATIONS_SCHEMA;
  readonly passed: boolean;
  readonly preview_id: string;
  readonly operation: Change["operation"];
  readonly affected_paths: readonly string[];
  readonly diff: string;
  readonly diagnostics: readonly Diagnostic[];
}

export interface ChangeResult {
  readonly schema: typeof OPERATIONS_SCHEMA;
  readonly outcome: "applied" | "unchanged" | "rejected";
  readonly operation: Change["operation"];
  readonly revisions: Readonly<Record<string, Revision | null>>;
  readonly diagnostics: readonly Diagnostic[];
}
