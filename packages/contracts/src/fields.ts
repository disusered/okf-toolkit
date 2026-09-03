/**
 * The frontmatter vocabulary OKF v0.2 specifies, as data.
 *
 * `spec/SPEC.md` already fixes every field, its shape, and its value domain — in normative
 * English rather than in a machine-readable form. Editors therefore had no choice but to
 * transcribe it by hand, each one drifting on its own schedule. This module transcribes it
 * once, here, in the package that vendors the specification, so a form can be rendered from
 * the same source the validators read.
 *
 * Two boundaries this file does not cross:
 *
 * It is a *vocabulary*, not a schema. §11 forbids rejecting a bundle for an unknown `type`, an
 * unknown key, or a missing optional field, so a consumer renders what it recognizes and passes
 * everything else through untouched. Nothing here licenses a consumer to refuse a document.
 *
 * It carries no consumer policy. A Profile may require what the specification leaves optional —
 * §5.4 makes an absent `status` mean `stable`, and a Profile is free to demand the key instead.
 * That belongs to the Profile, and stays there.
 */

/** How a field is written, which is what tells a consumer what control to offer for it. */
export type OkfFieldWidget =
  /** A single-line string. */
  | "text"
  /** A string long enough to want its own box. */
  | "textarea"
  /** A string drawn from `options`. */
  | "select"
  /** A `YYYY-MM-DD` calendar date. */
  | "date"
  /** An ISO 8601 datetime. */
  | "datetime"
  /** An identity in the §7 actor convention. */
  | "actor"
  /** A whole number. */
  | "integer"
  /** A boolean. */
  | "boolean"
  /** A URI, a bundle-relative path, or a scope descriptor (§6.2). */
  | "path"
  /** A list of short strings. */
  | "chips"
  /** A mapping whose members are `of`. */
  | "group"
  /** A repeated entry whose members are `of`. */
  | "list";

export interface OkfFieldDescriptor {
  /** The frontmatter key, as authored. */
  readonly key: string;
  readonly label: string;
  readonly widget: OkfFieldWidget;
  /**
   * Required by OKF v0.2 within whatever contains it — the document for `type`, the entry for
   * `sources[].resource`, the mapping for `generated.by`. Never a Profile's requirement.
   */
  readonly required?: boolean;
  /** The complete value domain, for `select` only. */
  readonly options?: readonly string[];
  /** The grammar a scalar must match, where the specification fixes one. */
  readonly pattern?: RegExp;
  /** Members of a `group` or of one `list` entry. */
  readonly of?: readonly OkfFieldDescriptor[];
  /** What the field means, short enough to sit beside the control. */
  readonly help: string;
  /** The section this entry was transcribed from, so it stays auditable against `SPEC.md`. */
  readonly spec: string;
}

/** `YYYY-MM-DD`. Shape only; `validDate` in okf-core also rejects an impossible day. */
export const OKF_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** ISO 8601 datetime with either `Z` or a numeric offset. */
export const OKF_DATETIME =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/;

/**
 * The §7 actor convention: `human:<id>`, `process:<id>`, or `<producer>/<version>`. Consumers
 * that classify trust key off the `human:` prefix, so the prefixes are not interchangeable.
 */
export const OKF_ACTOR = /^(?:human:[^\s/:]+|process:[^\s/:]+|[^\s/:]+\/[^\s/:]+)$/;

/** The `status` domain (§5.4). Absent `status` means `stable`; a Profile may demand the key. */
export const OKF_STATUSES = ["draft", "stable", "deprecated"] as const;

export type OkfStatus = (typeof OKF_STATUSES)[number];

/** The one type OKF v0.2 defines contract fields for (§10). */
export const OKF_ATTESTED_COMPUTATION = "Attested Computation";

/**
 * Fold a written type name onto its lookup key, so `ProjectBrief`, `Project Brief` and
 * `project-brief` agree rather than drifting apart. The camel-case split runs first, so the
 * one-word spelling reaches the same key as the two-word one.
 *
 * This is a lookup convenience, never a registry: §4.1 says type values are not registered
 * centrally, and §11 says an unknown type must be tolerated.
 */
export function okfTypeKey(type: string): string {
  return type
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** `{ from, to }`, framing every `usage_count` it applies to (§5.1). */
const USAGE_WINDOW: readonly OkfFieldDescriptor[] = [
  { key: "from", label: "From", widget: "date", pattern: OKF_DATE, help: "First day of the window.", spec: "5.1" },
  { key: "to", label: "To", widget: "date", pattern: OKF_DATE, help: "Last day of the window.", spec: "5.1" },
];

/**
 * Every field a concept may carry regardless of its type: the core keys of §4.1 and the
 * provenance, trust, and lifecycle families of §5.
 */
export const OKF_V02_CONCEPT_FIELDS: readonly OkfFieldDescriptor[] = [
  {
    key: "type",
    label: "Type",
    widget: "text",
    required: true,
    help: "The kind of concept this is. Pick something descriptive; types are not registered centrally.",
    spec: "4.1",
  },
  {
    key: "title",
    label: "Title",
    widget: "text",
    help: "Display name. Without one a consumer may fall back to the filename.",
    spec: "4.1",
  },
  {
    key: "description",
    label: "Description",
    widget: "textarea",
    help: "One sentence. Indexes, search snippets, and previews use it.",
    spec: "4.1",
  },
  {
    key: "resource",
    label: "Resource",
    widget: "path",
    help: "URI of the asset this page describes. Absent for a page about an idea rather than a thing.",
    spec: "4.1",
  },
  {
    key: "tags",
    label: "Tags",
    widget: "chips",
    help: "Short strings for cross-cutting categorization.",
    spec: "4.1",
  },
  {
    key: "status",
    label: "Status",
    widget: "select",
    options: OKF_STATUSES,
    help: "draft is unreviewed, stable is ready to consume, deprecated is kept for links and history.",
    spec: "5.4",
  },
  {
    key: "stale_after",
    label: "Stale after",
    widget: "date",
    pattern: OKF_DATE,
    help: "The day this content goes stale. An absolute date, not a countdown.",
    spec: "5.5",
  },
  {
    key: "generated",
    label: "Generated",
    widget: "group",
    of: [
      {
        key: "by",
        label: "By",
        widget: "actor",
        required: true,
        pattern: OKF_ACTOR,
        help: "Who or what wrote the current content.",
        spec: "5.2",
      },
      {
        key: "at",
        label: "At",
        widget: "datetime",
        pattern: OKF_DATETIME,
        help: "When the content last meaningfully changed.",
        spec: "5.2",
      },
    ],
    help: "How the content was produced. Distinct from who confirmed it.",
    spec: "5.2",
  },
  {
    key: "verified",
    label: "Verified",
    widget: "list",
    of: [
      {
        key: "by",
        label: "By",
        widget: "actor",
        required: true,
        pattern: OKF_ACTOR,
        help: "Who or what confirmed the content.",
        spec: "5.2",
      },
      {
        key: "at",
        label: "At",
        widget: "datetime",
        pattern: OKF_DATETIME,
        help: "When that confirmation happened.",
        spec: "5.2",
      },
    ],
    help: "Confirmation events. A bare mapping counts as one entry. Trust tier is derived from these.",
    spec: "5.2",
  },
  {
    key: "sources",
    label: "Sources",
    widget: "list",
    of: [
      {
        key: "id",
        label: "Id",
        widget: "text",
        help: "Stable key a footnote in the body cites to attribute one claim.",
        spec: "5.1",
      },
      {
        key: "resource",
        label: "Resource",
        widget: "path",
        required: true,
        help: "The artifact this derives from, or a scope descriptor naming a population.",
        spec: "5.1",
      },
      { key: "title", label: "Title", widget: "text", help: "Human-readable label.", spec: "5.1" },
      {
        key: "author",
        label: "Author",
        widget: "actor",
        pattern: OKF_ACTOR,
        help: "Who produced the source. An authority signal.",
        spec: "5.1",
      },
      {
        key: "usage_count",
        label: "Usage count",
        widget: "integer",
        help: "How often the source was exercised over the usage window. Read it as liveness, not as a score.",
        spec: "5.1",
      },
      {
        key: "last_modified",
        label: "Last modified",
        widget: "date",
        pattern: OKF_DATE,
        help: "When the source itself last changed, which is not when this page was written.",
        spec: "5.1",
      },
      {
        key: "usage_window",
        label: "Usage window",
        widget: "group",
        of: USAGE_WINDOW,
        help: "Overrides the shared window for this entry alone.",
        spec: "5.1",
      },
    ],
    help: "What this page was derived from, with the signals a reader judges credibility by.",
    spec: "5.1",
  },
  {
    key: "usage_window",
    label: "Usage window",
    widget: "group",
    of: USAGE_WINDOW,
    help: "Frames every usage count on this page that has no window of its own.",
    spec: "5.1",
  },
];

/** The contract fields an Attested Computation carries on top of the common set (§10.2). */
export const OKF_V02_ATTESTED_COMPUTATION_FIELDS: readonly OkfFieldDescriptor[] = [
  {
    key: "runtime",
    label: "Runtime",
    widget: "text",
    required: true,
    help: "How the computation runs, which fixes what the parameters mean. For example bigquery, dbt, python.",
    spec: "10.2",
  },
  {
    key: "parameters",
    label: "Parameters",
    widget: "list",
    of: [
      { key: "name", label: "Name", widget: "text", required: true, help: "The hole's name.", spec: "10.2" },
      {
        key: "type",
        label: "Type",
        widget: "text",
        required: true,
        help: "The value's type, interpreted by the runtime.",
        spec: "10.2",
      },
      {
        key: "required",
        label: "Required",
        widget: "boolean",
        help: "Whether a run must supply it.",
        spec: "10.2",
      },
    ],
    help: "The typed, named holes an agent may fill.",
    spec: "10.2",
  },
  {
    key: "computation",
    label: "Computation",
    widget: "path",
    help: "A file holding the computation. Absent means the body's Computation fence is the computation.",
    spec: "10.2",
  },
  {
    key: "executor",
    label: "Executor",
    widget: "group",
    of: [
      {
        key: "resource",
        label: "Resource",
        widget: "path",
        help: "Run instructions or code a runner follows.",
        spec: "10.2",
      },
      {
        key: "receipt",
        label: "Receipt",
        widget: "chips",
        help: "The fields a run must return, which are the evidence the attester inspects.",
        spec: "10.2",
      },
    ],
    help: "How the computation is run.",
    spec: "10.2",
  },
  {
    key: "attester",
    label: "Attester",
    widget: "group",
    of: [
      {
        key: "resource",
        label: "Resource",
        widget: "path",
        help: "Code, with no model in the loop, that turns a receipt into a verdict.",
        spec: "10.2",
      },
    ],
    help: "The deterministic check, meant to run consumer-side.",
    spec: "10.2",
  },
];

/**
 * The only frontmatter a bundle-root `index.md` may carry (§8, §12). Every other index file
 * carries none at all.
 */
export const OKF_V02_ROOT_INDEX_FIELDS: readonly OkfFieldDescriptor[] = [
  {
    key: "okf_version",
    label: "OKF version",
    widget: "text",
    help: "The format version this bundle targets. The only key a root index may carry.",
    spec: "12",
  },
];

/** Per-type additions, keyed by `okfTypeKey`. Only the type §10 defines fields for appears. */
const TYPE_FIELDS: Readonly<Record<string, readonly OkfFieldDescriptor[]>> = {
  [okfTypeKey(OKF_ATTESTED_COMPUTATION)]: OKF_V02_ATTESTED_COMPUTATION_FIELDS,
};

/**
 * The fields a concept of this type may carry: the common set, then any the type adds. An
 * unrecognized type is not an error and adds nothing — §11 requires tolerating it.
 */
export function okfFieldsForType(type: string | null | undefined): readonly OkfFieldDescriptor[] {
  const extra = typeof type === "string" ? TYPE_FIELDS[okfTypeKey(type)] : undefined;
  return extra ? [...OKF_V02_CONCEPT_FIELDS, ...extra] : OKF_V02_CONCEPT_FIELDS;
}
