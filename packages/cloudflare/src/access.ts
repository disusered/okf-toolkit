import { createRemoteJWKSet, jwtVerify } from "jose";

import type { OkfPrincipal } from "./worker.js";

export interface AccessAuthorizerOptions {
  /** The Access team domain, such as `example.cloudflareaccess.com`. */
  readonly teamDomain: string;
  /** The Application Audience (AUD) tag of the Access application in front of this Worker. */
  readonly audience: string;
}

/** Answers who sent a request that Cloudflare Access let through, or null. */
export type AccessAuthorizer = (request: Request) => Promise<OkfPrincipal | null>;

// One key set per team domain and isolate. jose caches the keys in memory and refetches on
// rotation, so a rotated key is picked up without a JWKS request on every call.
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function keySetFor(teamDomain: string): ReturnType<typeof createRemoteJWKSet> {
  let keys = keySets.get(teamDomain);
  if (keys === undefined) {
    keys = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    keySets.set(teamDomain, keys);
  }
  return keys;
}

/**
 * Verify the assertion Cloudflare Access adds after it has authenticated a caller.
 *
 * Access already guards the hostname. A Worker still checks the assertion because it is
 * reachable on Cloudflare's edge, and because the verified `email` claim is what decides who
 * may write. The principal's email is lowercased so allowlists compare reliably.
 *
 * Every failure returns null without detail: a caller never learns why a token was refused.
 */
export function accessAuthorizer(options: AccessAuthorizerOptions): AccessAuthorizer {
  const issuer = `https://${options.teamDomain}`;
  return async (request) => {
    const assertion = request.headers.get("cf-access-jwt-assertion")
      ?? request.headers.get("cf-access-token");
    if (!assertion) return null;
    try {
      const { payload } = await jwtVerify(assertion, keySetFor(options.teamDomain), {
        issuer,
        audience: options.audience,
      });
      if (typeof payload.sub !== "string" || payload.sub.length === 0) return null;
      const email = typeof payload["email"] === "string" ? payload["email"].toLowerCase() : undefined;
      return { subject: payload.sub, ...(email === undefined ? {} : { email }) };
    } catch {
      return null;
    }
  };
}
