import type { Diagnostic } from "okf-contracts";

import { byCodePoint } from "./paths.js";

export function diagnostic(
  family: Diagnostic["family"],
  severity: Diagnostic["severity"],
  code: string,
  path: string,
  message: string,
  range?: Diagnostic["range"],
): Diagnostic {
  return {
    family,
    severity,
    code,
    path,
    message,
    ...(range === undefined ? {} : { range }),
  };
}

export function compareDiagnostics(left: Diagnostic, right: Diagnostic): number {
  return (
    byCodePoint(left.path, right.path) ||
    byCodePoint(left.family, right.family) ||
    byCodePoint(left.code, right.code) ||
    (left.range?.start.offset ?? -1) - (right.range?.start.offset ?? -1) ||
    byCodePoint(left.message, right.message)
  );
}
