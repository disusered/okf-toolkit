import type { IntegrityInput } from "./index.js";

/** Stable cross-runtime fixture for canonicalization and Ed25519 interoperability tests. */
export const INTEGRITY_TEST_VECTOR_INPUTS: readonly IntegrityInput[] = [
  {
    path: "index.md",
    content: '---\nokf_version: "0.2"\n---\n\n# Example\n',
  },
  {
    path: "concepts/example.md",
    content: "---\ntype: Concept\ntitle: Example\ndescription: An example.\n---\n\n# Example\n",
  },
];

/** RFC 8032 test-vector key material, encoded as WebCrypto JWK. */
export const ED25519_TEST_PRIVATE_JWK: JsonWebKey = {
  kty: "OKP",
  crv: "Ed25519",
  x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
  d: "nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A",
};

export const ED25519_TEST_PUBLIC_JWK: JsonWebKey = {
  kty: "OKP",
  crv: "Ed25519",
  x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
};

export const INTEGRITY_TEST_VECTOR_CANONICAL =
  '{"schema":"okf.integrity.v1","digest":"SHA-256","files":[{"path":"concepts/example.md","bytes":73,"sha256":"92055d7be08ccb99c9fc14511c0e134fece3599ca0e314bdcde325d863706d40"},{"path":"index.md","bytes":38,"sha256":"5556b8b6256e8fffdef796f7e48150cc401cb54530e385f1461f9e110cb4d532"}]}\n';

export const INTEGRITY_TEST_VECTOR_SIGNATURE =
  "OcmF-W_ULDnMouRAQM1_HRJAH0oW3rd_IMHZIRQDrWntzF6lGsHsC18toC6ZbkSer0VjVA57BSS7oxLewGqNBQ";
