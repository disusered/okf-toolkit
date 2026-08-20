import type {
  R2BucketLike,
  R2ListResultLike,
  R2ObjectBodyLike,
  R2ObjectLike,
  R2PutOptionsLike,
} from "../src/r2.js";

interface Stored {
  body: string;
  etag: string;
  contentType?: string;
  customMetadata?: Readonly<Record<string, string>>;
}

export function memoryBucket(seed: Readonly<Record<string, string>> = {}) {
  const objects = new Map<string, Stored>();
  const writes: { key: string; body: string; contentType?: string }[] = [];
  let revision = 0;
  const next = () => `etag-${revision += 1}`;
  for (const [key, body] of Object.entries(seed)) objects.set(key, { body, etag: next() });

  const bucket: R2BucketLike = {
    async get(key): Promise<R2ObjectBodyLike | null> {
      const object = objects.get(key);
      if (!object) return null;
      return {
        key,
        etag: object.etag,
        size: new TextEncoder().encode(object.body).byteLength,
        text: async () => object.body,
        ...(object.customMetadata === undefined ? {} : { customMetadata: object.customMetadata }),
      };
    },
    async list(options): Promise<R2ListResultLike> {
      const keys = [...objects.keys()].filter((key) => key.startsWith(options.prefix)).sort();
      const start = options.cursor ? Number(options.cursor) : 0;
      const limit = Math.min(options.limit ?? 1_000, 2);
      const selected = keys.slice(start, start + limit);
      const result: R2ListResultLike = {
        objects: selected.map((key): R2ObjectLike => {
          const object = objects.get(key)!;
          return { key, etag: object.etag, size: object.body.length };
        }),
        truncated: start + limit < keys.length,
        ...(start + limit < keys.length ? { cursor: String(start + limit) } : {}),
      };
      return result;
    },
    async put(key, value, options?: R2PutOptionsLike): Promise<R2ObjectLike | null> {
      const body = typeof value === "string" ? value : new TextDecoder().decode(value);
      const current = objects.get(key);
      if (options?.onlyIf?.etagMatches !== undefined && current?.etag !== options.onlyIf.etagMatches) {
        return null;
      }
      if (options?.onlyIf?.etagDoesNotMatch === "*" && current !== undefined) return null;
      const stored: Stored = {
        body,
        etag: next(),
        ...(options?.httpMetadata?.contentType === undefined
          ? {}
          : { contentType: options.httpMetadata.contentType }),
        ...(options?.customMetadata === undefined ? {} : { customMetadata: options.customMetadata }),
      };
      objects.set(key, stored);
      writes.push({
        key,
        body,
        ...(stored.contentType === undefined ? {} : { contentType: stored.contentType }),
      });
      return { key, etag: stored.etag, size: body.length };
    },
    async delete(key): Promise<void> {
      objects.delete(key);
    },
  };
  return { bucket, objects, writes };
}

export function queueBatch(...keys: string[]) {
  const outcomes: string[] = [];
  return {
    outcomes,
    batch: {
      messages: keys.map((key) => ({ body: { object: { key } } })),
      ackAll: () => outcomes.push("ack"),
      retryAll: () => outcomes.push("retry"),
    },
  };
}
