import path from "node:path";

import type { McpServer } from "@modelcontextprotocol/server";
import type { AnalyzeBundleOptions } from "okf-core";
import { createOkfV1McpServer, type OkfV1Operations } from "okf-contracts";
import { loadValidationProfile, resolveBundleTarget, type ResolvedBundleTarget } from "okf-node";

import { bundleSettings, type BundleSettings } from "./bundle.js";
import { createFilesystemOkfV1Operations } from "./operations.js";

/**
 * The version this server reports to a client. It is a constant rather than a read of
 * `package.json`, which does not sit under `rootDir`; `test/version.test.ts` keeps the two
 * from drifting.
 */
export const SERVER_VERSION = "2.0.0";

export interface OkfLocalServerOptions {
  /** Absolute or relative project root. Relative paths resolve against `cwd`. */
  readonly projectRoot: string;
  readonly bundle: string;
  /** Trusted module specifier, resolved against the bundle's project root. */
  readonly profileModule?: string;
  readonly today?: string;
  /** Only used to resolve a relative `projectRoot`. Defaults to the process cwd. */
  readonly cwd?: string;
  readonly visualizationDirectory?: string;
}

export interface OkfLocalServer {
  readonly target: ResolvedBundleTarget;
  readonly settings: BundleSettings;
  readonly operations: OkfV1Operations;
  /** One MCP server instance. The stdio and HTTP entries call this per connection. */
  createServer(): McpServer;
}

/**
 * Resolve one manifest bundle off the filesystem and build the MCP surface over it.
 *
 * Every failure a deployment can fix — an unknown bundle name, an unreadable profile, an
 * `access` value nothing defines — happens here, at startup, rather than on a tool call.
 */
export async function createOkfLocalServer(options: OkfLocalServerOptions): Promise<OkfLocalServer> {
  const projectRoot = path.resolve(options.cwd ?? process.cwd(), options.projectRoot);
  const target = await resolveBundleTarget(projectRoot, options.bundle);
  const settings = bundleSettings(target);

  const analysis: AnalyzeBundleOptions = {
    ...(options.today === undefined ? {} : { today: options.today }),
    // Resolved against the bundle's own project root, so `.agents/okf-private-profile.mjs`
    // means the same thing here as it does in the repository's npm scripts.
    ...(options.profileModule === undefined
      ? {}
      : { profile: await loadValidationProfile(target.projectRoot, options.profileModule) }),
  };

  const operations = createFilesystemOkfV1Operations({
    target,
    settings,
    analysis,
    ...(options.visualizationDirectory === undefined
      ? {}
      : { visualizationDirectory: options.visualizationDirectory }),
  });

  return {
    target,
    settings,
    operations,
    createServer: () => createOkfV1McpServer({
      name: `okf-${settings.name}`,
      version: SERVER_VERSION,
      bundle: settings.name,
      operations,
    }),
  };
}
