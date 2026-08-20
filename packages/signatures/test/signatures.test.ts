import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizeBundleIntegrityManifest,
  confineIntegrityPath,
  createBundleIntegrityManifest,
  signBundleIntegrityManifest,
  verifyBundleIntegrity,
} from "../src/index.js";
import {
  ED25519_TEST_PRIVATE_JWK,
  ED25519_TEST_PUBLIC_JWK,
  INTEGRITY_TEST_VECTOR_CANONICAL,
  INTEGRITY_TEST_VECTOR_INPUTS,
  INTEGRITY_TEST_VECTOR_SIGNATURE,
} from "../src/test-vectors.js";

async function keys(): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey }> {
  return {
    privateKey: await crypto.subtle.importKey(
      "jwk", ED25519_TEST_PRIVATE_JWK, "Ed25519", false, ["sign"],
    ),
    publicKey: await crypto.subtle.importKey(
      "jwk", ED25519_TEST_PUBLIC_JWK, "Ed25519", false, ["verify"],
    ),
  };
}

test("canonical manifest is stable across input order", async () => {
  const first = await createBundleIntegrityManifest(INTEGRITY_TEST_VECTOR_INPUTS);
  const second = await createBundleIntegrityManifest([...INTEGRITY_TEST_VECTOR_INPUTS].reverse());
  assert.equal(canonicalizeBundleIntegrityManifest(first), canonicalizeBundleIntegrityManifest(second));
  assert.equal(canonicalizeBundleIntegrityManifest(first), INTEGRITY_TEST_VECTOR_CANONICAL);
  assert.equal(first.files[0]?.path, "concepts/example.md");
  assert.match(canonicalizeBundleIntegrityManifest(first), /\n$/);
});

test("paths cannot escape or alias a bundle path", () => {
  assert.equal(confineIntegrityPath("concepts/example.md"), "concepts/example.md");
  assert.equal(confineIntegrityPath(" concepts/example.md "), " concepts/example.md ");
  const decomposed = "concepts/cafe\u0301.md";
  assert.equal(confineIntegrityPath(decomposed), decomposed);
  for (const path of ["/index.md", "C:/index.md", "../index.md", "a/../index.md", "a//b.md", "a\\b.md"]) {
    assert.throws(() => confineIntegrityPath(path));
  }
});

test("integrity manifests preserve canonically distinct Unicode paths", async () => {
  const decomposed = "concepts/cafe\u0301.md";
  const composed = "concepts/caf\u00e9.md";
  const manifest = await createBundleIntegrityManifest([
    { path: decomposed, content: "decomposed" },
    { path: composed, content: "composed" },
  ]);
  assert.deepEqual(new Set(manifest.files.map((file) => file.path)), new Set([decomposed, composed]));
});

test("signature and bundle content verify independently from OKF conformance", async () => {
  const { privateKey, publicKey } = await keys();
  const manifest = await createBundleIntegrityManifest(INTEGRITY_TEST_VECTOR_INPUTS);
  const envelope = await signBundleIntegrityManifest(manifest, privateKey, "rfc8032-test-key");
  assert.equal(envelope.signature, INTEGRITY_TEST_VECTOR_SIGNATURE);
  const result = await verifyBundleIntegrity(envelope, publicKey, INTEGRITY_TEST_VECTOR_INPUTS);

  assert.deepEqual(result, {
    integrity: "valid",
    signatureValid: true,
    contentValid: true,
    diagnostics: [],
  });
  assert.equal("verified" in result, false);
});

test("changed and unsigned content is diagnosed", async () => {
  const { privateKey, publicKey } = await keys();
  const manifest = await createBundleIntegrityManifest(INTEGRITY_TEST_VECTOR_INPUTS);
  const envelope = await signBundleIntegrityManifest(manifest, privateKey, "rfc8032-test-key");
  const result = await verifyBundleIntegrity(envelope, publicKey, [
    { path: "index.md", content: "changed" },
    { path: "extra.md", content: "extra" },
  ]);

  assert.equal(result.integrity, "invalid");
  assert.equal(result.signatureValid, true);
  assert.equal(result.contentValid, false);
  assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code).sort(), [
    "content-mismatch",
    "missing-file",
    "unexpected-file",
  ]);
});

test("tampering with the manifest invalidates the signature", async () => {
  const { privateKey, publicKey } = await keys();
  const manifest = await createBundleIntegrityManifest(INTEGRITY_TEST_VECTOR_INPUTS);
  const envelope = await signBundleIntegrityManifest(manifest, privateKey, "rfc8032-test-key");
  const tampered = {
    ...envelope,
    manifest: {
      ...envelope.manifest,
      files: envelope.manifest.files.map((file, index) => index === 0 ? { ...file, bytes: file.bytes + 1 } : file),
    },
  };

  const result = await verifyBundleIntegrity(tampered, publicKey);
  assert.equal(result.integrity, "invalid");
  assert.equal(result.signatureValid, false);
  assert.equal(result.contentValid, null);
});
