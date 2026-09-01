import type { ResolvedBundleTarget } from "okf-node";

/**
 * What the manifest's `access` field means to this server. `read` serves the seven read
 * operations and refuses the two writing ones.
 */
export type BundleAccess = "read" | "read-write";

const ACCESS_VALUES: Readonly<Record<string, BundleAccess>> = {
  read: "read",
  "read-only": "read",
  "read-write": "read-write",
};

export interface BundleSettings {
  readonly name: string;
  readonly adapter: string;
  readonly audience: string;
  readonly access: BundleAccess;
  /** The bundle-relative index document, from the manifest or the OKF default. */
  readonly index: string;
}

/**
 * Read one manifest bundle's declared settings.
 *
 * `access` is rejected rather than guessed when it is a value nothing here defines: a typo
 * such as `readonly` must not quietly widen a read bundle into a writable one.
 */
export function bundleSettings(target: ResolvedBundleTarget): BundleSettings {
  if (target.manifest === null || target.name === null) {
    throw new Error("okf-mcp serves a manifest bundle; no .agents/okf.yaml bundle was resolved");
  }
  const declared = target.manifest.bundles[target.name];
  if (declared === undefined) {
    throw new Error(`manifest does not declare bundle ${target.name}`);
  }
  let access: BundleAccess = "read-write";
  if (declared.access !== undefined) {
    const declaredAccess = ACCESS_VALUES[declared.access];
    if (declaredAccess === undefined) {
      throw new Error(
        `bundle ${target.name}.access must be read, read-only, or read-write; received ${declared.access}`,
      );
    }
    access = declaredAccess;
  }
  return {
    name: target.name,
    adapter: target.manifest.adapter ?? "filesystem",
    audience: declared.audience ?? "unspecified",
    access,
    index: declared.index ?? "index.md",
  };
}
