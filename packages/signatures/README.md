# okf-signatures

`okf-signatures` creates optional Ed25519 integrity manifests for exact Bundle
bytes. It reports whether a signed file inventory and the supplied bytes match.
It does not alter OKF v0.2 `verified` records or decide whether a key is trusted.

```ts
import {
  createBundleIntegrityManifest,
  signBundleIntegrityManifest,
  verifyBundleIntegrity,
} from "okf-signatures";
```

Consumers select their own trusted public key for an envelope's `key_id`. Paths
are confined Bundle-relative POSIX paths, files are ordered deterministically,
digests use SHA-256, signatures use Ed25519 WebCrypto, and signatures are
unpadded base64url. The package exports stable test vectors from
`okf-signatures/test-vectors`.
