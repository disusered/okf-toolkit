import assert from "node:assert/strict";
import test from "node:test";

import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";

import { accessAuthorizer } from "../src/access.js";

const TEAM = "team.example.test";
const AUDIENCE = "aud-tag";

interface Keys {
  readonly privateKey: CryptoKey;
  readonly jwk: JWK;
}

async function keys(kid: string): Promise<Keys> {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  return { privateKey, jwk: { ...await exportJWK(publicKey), kid, alg: "RS256", use: "sig" } };
}

async function token(
  signing: Keys,
  claims: Record<string, unknown>,
  options: { issuer?: string; audience?: string; expires?: string } = {},
): Promise<string> {
  return await new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: signing.jwk.kid! })
    .setIssuer(options.issuer ?? `https://${TEAM}`)
    .setAudience(options.audience ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(options.expires ?? "5m")
    .sign(signing.privateKey);
}

function serveKeys(published: readonly JWK[]): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    assert.equal(url, `https://${TEAM}/cdn-cgi/access/certs`);
    return Response.json({ keys: published });
  };
  return () => { globalThis.fetch = original; };
}

function requestWith(assertion?: string): Request {
  return new Request("https://knowledge.example.test/v1/mcp", {
    headers: assertion === undefined ? {} : { "cf-access-jwt-assertion": assertion },
  });
}

test("a valid Access assertion yields the subject and a lowercased email", async () => {
  const signing = await keys("current");
  const restore = serveKeys([signing.jwk]);
  try {
    const authorize = accessAuthorizer({ teamDomain: TEAM, audience: AUDIENCE });
    const principal = await authorize(requestWith(await token(signing, { sub: "user-1", email: "Person@Example.Test" })));
    assert.deepEqual(principal, { subject: "user-1", email: "person@example.test" });
  } finally {
    restore();
  }
});

test("every unusable assertion is refused without detail", async () => {
  const signing = await keys("current-refusals");
  const stranger = await keys("not-published");
  const restore = serveKeys([signing.jwk]);
  try {
    const authorize = accessAuthorizer({ teamDomain: TEAM, audience: AUDIENCE });
    const refused = [
      requestWith(),
      requestWith("not-a-jwt"),
      requestWith(await token(signing, { sub: "user-1" }, { audience: "another-app" })),
      requestWith(await token(signing, { sub: "user-1" }, { issuer: "https://other.example.test" })),
      requestWith(await token(signing, { sub: "user-1" }, { expires: "-1m" })),
      requestWith(await token(signing, {})),
      requestWith(await token(stranger, { sub: "user-1" })),
    ];
    for (const request of refused) assert.equal(await authorize(request), null);
  } finally {
    restore();
  }
});
