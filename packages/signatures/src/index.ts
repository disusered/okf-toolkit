import { byCodePoint, validateBundlePath } from "okf-core";

const textEncoder = new TextEncoder();

export interface IntegrityInput {
  readonly path: string;
  readonly content: string | Uint8Array;
}

export interface IntegrityFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

/** A content inventory. This is integrity evidence, not an OKF conformance tier. */
export interface BundleIntegrityManifest {
  readonly schema: "okf.integrity.v1";
  readonly digest: "SHA-256";
  readonly files: readonly IntegrityFile[];
}

export interface SignedBundleIntegrityManifest {
  readonly schema: "okf.signature.v1";
  readonly algorithm: "Ed25519";
  readonly key_id: string;
  readonly manifest: BundleIntegrityManifest;
  readonly signature: string;
}

export interface IntegrityDiagnostic {
  readonly code:
    | "invalid-manifest"
    | "invalid-signature"
    | "missing-file"
    | "unexpected-file"
    | "content-mismatch";
  readonly path?: string;
  readonly message: string;
}

/**
 * Deliberately does not expose an OKF `verified` value. Cryptographic integrity and
 * OKF conformance answer different questions and must be reported independently.
 */
export interface IntegrityResult {
  readonly integrity: "valid" | "invalid";
  readonly signatureValid: boolean;
  readonly contentValid: boolean | null;
  readonly diagnostics: readonly IntegrityDiagnostic[];
}

export class IntegrityPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrityPathError";
  }
}

/** Return a canonical bundle-relative POSIX path, refusing absolute and traversing input. */
export function confineIntegrityPath(path: string): string {
  try {
    return validateBundlePath(path);
  } catch (error) {
    throw new IntegrityPathError(error instanceof Error ? error.message : `unsafe bundle path: ${path}`);
  }
}

function bytesOf(content: string | Uint8Array): Uint8Array<ArrayBuffer> {
  return typeof content === "string" ? textEncoder.encode(content) : new Uint8Array(content);
}

function hexadecimal(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64UrlEncode(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let output = "";
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const first = bytes[offset] ?? 0;
    const second = bytes[offset + 1];
    const third = bytes[offset + 2];
    const value = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    output += alphabet[(value >>> 18) & 63];
    output += alphabet[(value >>> 12) & 63];
    if (second !== undefined) output += alphabet[(value >>> 6) & 63];
    if (third !== undefined) output += alphabet[value & 63];
  }
  return output;
}

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) return null;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const output: number[] = [];
  for (let offset = 0; offset < value.length; offset += 4) {
    const chunk = value.slice(offset, offset + 4);
    let bits = 0;
    for (const character of chunk) bits = (bits << 6) | alphabet.indexOf(character);
    const missing = 4 - chunk.length;
    bits <<= missing * 6;
    output.push((bits >>> 16) & 255);
    if (chunk.length > 2) output.push((bits >>> 8) & 255);
    if (chunk.length > 3) output.push(bits & 255);
  }
  return new Uint8Array(output);
}

export async function createBundleIntegrityManifest(
  inputs: readonly IntegrityInput[],
): Promise<BundleIntegrityManifest> {
  const files: IntegrityFile[] = [];
  const paths = new Set<string>();
  for (const input of inputs) {
    const path = confineIntegrityPath(input.path);
    if (paths.has(path)) throw new IntegrityPathError(`duplicate bundle path: ${path}`);
    paths.add(path);
    const content = bytesOf(input.content);
    files.push({
      path,
      bytes: content.byteLength,
      sha256: hexadecimal(await crypto.subtle.digest("SHA-256", content)),
    });
  }
  files.sort((left, right) => byCodePoint(left.path, right.path));
  return { schema: "okf.integrity.v1", digest: "SHA-256", files };
}

function assertManifest(manifest: BundleIntegrityManifest): void {
  if (manifest.schema !== "okf.integrity.v1" || manifest.digest !== "SHA-256") {
    throw new Error("unsupported bundle integrity manifest");
  }
  let previous: string | undefined;
  for (const file of manifest.files) {
    const path = confineIntegrityPath(file.path);
    if (path !== file.path || previous !== undefined && byCodePoint(previous, path) >= 0) {
      throw new Error("manifest files must have unique canonical paths in ascending order");
    }
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[0-9a-f]{64}$/.test(file.sha256)) {
      throw new Error(`manifest has an invalid file record: ${path}`);
    }
    previous = path;
  }
}

/** Canonical UTF-8 JSON signed by this package. Property order and the final newline are fixed. */
export function canonicalizeBundleIntegrityManifest(manifest: BundleIntegrityManifest): string {
  assertManifest(manifest);
  return `${JSON.stringify({
    schema: manifest.schema,
    digest: manifest.digest,
    files: manifest.files.map((file) => ({ path: file.path, bytes: file.bytes, sha256: file.sha256 })),
  })}\n`;
}

export async function signBundleIntegrityManifest(
  manifest: BundleIntegrityManifest,
  privateKey: CryptoKey,
  keyId: string,
): Promise<SignedBundleIntegrityManifest> {
  if (!keyId.trim()) throw new Error("key id must not be empty");
  const canonical = textEncoder.encode(canonicalizeBundleIntegrityManifest(manifest));
  const signature = await crypto.subtle.sign("Ed25519", privateKey, canonical);
  return {
    schema: "okf.signature.v1",
    algorithm: "Ed25519",
    key_id: keyId,
    manifest,
    signature: base64UrlEncode(new Uint8Array(signature)),
  };
}

export async function verifyBundleIntegrity(
  envelope: SignedBundleIntegrityManifest,
  publicKey: CryptoKey,
  inputs?: readonly IntegrityInput[],
): Promise<IntegrityResult> {
  const diagnostics: IntegrityDiagnostic[] = [];
  let canonical: string;
  try {
    if (envelope.schema !== "okf.signature.v1" || envelope.algorithm !== "Ed25519") {
      throw new Error("unsupported signature envelope");
    }
    canonical = canonicalizeBundleIntegrityManifest(envelope.manifest);
  } catch (error) {
    diagnostics.push({
      code: "invalid-manifest",
      message: error instanceof Error ? error.message : "invalid integrity manifest",
    });
    return { integrity: "invalid", signatureValid: false, contentValid: null, diagnostics };
  }

  const signature = base64UrlDecode(envelope.signature);
  const signatureValid = signature !== null && await crypto.subtle.verify(
    "Ed25519",
    publicKey,
    signature,
    textEncoder.encode(canonical),
  );
  if (!signatureValid) {
    diagnostics.push({ code: "invalid-signature", message: "manifest signature is invalid" });
  }

  let contentValid: boolean | null = null;
  if (inputs !== undefined) {
    contentValid = true;
    let actual: BundleIntegrityManifest;
    try {
      actual = await createBundleIntegrityManifest(inputs);
    } catch (error) {
      diagnostics.push({
        code: "invalid-manifest",
        message: error instanceof Error ? error.message : "invalid bundle input",
      });
      actual = { schema: "okf.integrity.v1", digest: "SHA-256", files: [] };
      contentValid = false;
    }
    const expectedByPath = new Map(envelope.manifest.files.map((file) => [file.path, file]));
    const actualByPath = new Map(actual.files.map((file) => [file.path, file]));
    for (const expected of envelope.manifest.files) {
      const found = actualByPath.get(expected.path);
      if (!found) {
        diagnostics.push({ code: "missing-file", path: expected.path, message: "signed file is missing" });
        contentValid = false;
      } else if (found.bytes !== expected.bytes || found.sha256 !== expected.sha256) {
        diagnostics.push({ code: "content-mismatch", path: expected.path, message: "file does not match its signed digest" });
        contentValid = false;
      }
    }
    for (const found of actual.files) {
      if (!expectedByPath.has(found.path)) {
        diagnostics.push({ code: "unexpected-file", path: found.path, message: "bundle contains an unsigned file" });
        contentValid = false;
      }
    }
  }

  return {
    integrity: signatureValid && contentValid !== false ? "valid" : "invalid",
    signatureValid,
    contentValid,
    diagnostics,
  };
}
