import type { RawBundleDocument } from "okf-contracts";
import { byCodePoint, validateBundlePath } from "okf-core";

import { R2BundleAdapter, type R2BucketLike } from "./r2.js";

export interface QueueMessageLike<T = unknown> {
  readonly body: T;
}

export interface QueueBatchLike<T = unknown> {
  readonly messages: readonly QueueMessageLike<T>[];
  ackAll(): void;
  retryAll(): void;
}

export interface VisualizationBuildInput {
  readonly bundle: string;
  readonly documents: readonly RawBundleDocument[];
}

export interface VisualizationQueueOptions<Env> {
  readonly bundle: string;
  readonly bundlePrefix: string;
  readonly outputPrefix: string;
  readonly outputKey: string;
  bucket(env: Env): R2BucketLike | null;
  build(input: VisualizationBuildInput): string | Promise<string>;
  readonly log?: (event: string, detail: Readonly<Record<string, unknown>>) => void;
}

function normalizedPrefix(value: string, name: string): string {
  const stripped = value.replace(/^\/+|\/+$/g, "");
  try {
    validateBundlePath(stripped);
  } catch {
    throw new Error(`${name} must be a confined relative prefix`);
  }
  return `${stripped}/`;
}

function mapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function r2EventObjectKey(body: unknown): string | null {
  if (!mapping(body)) return null;
  const object = body.object;
  if (!mapping(object)) return null;
  const key = object.key;
  return typeof key === "string" ? key : null;
}

/** Coalesce duplicate/unordered events and explicitly ignore generated output. */
export function corpusEventKeys(
  bodies: readonly unknown[],
  bundlePrefix: string,
  outputPrefix: string,
): readonly string[] {
  const bundle = normalizedPrefix(bundlePrefix, "bundle prefix");
  const output = normalizedPrefix(outputPrefix, "output prefix");
  const keys = new Set<string>();
  for (const body of bodies) {
    const key = r2EventObjectKey(body);
    if (key === null || key.startsWith(output) || !key.startsWith(bundle)) continue;
    keys.add(key);
  }
  return [...keys].sort(byCodePoint);
}

/**
 * Create an at-least-once-safe queue consumer. Each relevant batch rebuilds one deterministic
 * projection from the current complete bundle; event order is never used as corpus state.
 */
export function createVisualizationQueueWorker<Env>(options: VisualizationQueueOptions<Env>) {
  const bundlePrefix = normalizedPrefix(options.bundlePrefix, "bundle prefix");
  const outputPrefix = normalizedPrefix(options.outputPrefix, "output prefix");
  if (outputPrefix.startsWith(bundlePrefix) || bundlePrefix.startsWith(outputPrefix)) {
    throw new Error("visualization output prefix must not overlap the authored bundle prefix");
  }
  if (!options.outputKey.startsWith(outputPrefix)) {
    throw new Error("visualization output key must be inside the output prefix");
  }
  const emit = options.log ?? (() => undefined);

  return {
    async queue(batch: QueueBatchLike, env: Env): Promise<void> {
      const keys = corpusEventKeys(
        batch.messages.map((message) => message.body),
        bundlePrefix,
        outputPrefix,
      );
      if (keys.length === 0) {
        emit("okf_v1_visualization_skipped", { messages: batch.messages.length });
        batch.ackAll();
        return;
      }

      const bucket = options.bucket(env);
      if (!bucket) {
        emit("okf_v1_visualization_failed", { reason: "missing bucket binding" });
        batch.retryAll();
        return;
      }

      try {
        const adapter = new R2BundleAdapter(bucket, {
          bundle: options.bundle,
          prefix: bundlePrefix,
        });
        const documents = await adapter.documents();
        if (documents.length === 0) {
          emit("okf_v1_visualization_skipped", { reason: "empty bundle" });
          batch.ackAll();
          return;
        }
        const html = await options.build({ bundle: options.bundle, documents });
        await bucket.put(options.outputKey, html, {
          httpMetadata: { contentType: "text/html; charset=utf-8" },
        });
        emit("okf_v1_visualization_rebuilt", {
          key: options.outputKey,
          pages: documents.length,
          triggering_keys: keys,
        });
        batch.ackAll();
      } catch (error) {
        emit("okf_v1_visualization_failed", {
          reason: error instanceof Error ? error.message : "unknown error",
        });
        batch.retryAll();
      }
    },
  };
}
