import type { Change, RawBundleDocument, Revision } from "okf-contracts";
import { byCodePoint, validateBundlePath } from "okf-core";

export interface R2ObjectLike {
  readonly key: string;
  readonly etag: string;
  readonly size: number;
  readonly customMetadata?: Readonly<Record<string, string>>;
}

export interface R2ObjectBodyLike extends R2ObjectLike {
  text(): Promise<string>;
  readonly body?: ReadableStream<Uint8Array>;
}

export interface R2ListResultLike {
  readonly objects: readonly R2ObjectLike[];
  readonly truncated: boolean;
  readonly cursor?: string;
}

export interface R2PutOptionsLike {
  readonly onlyIf?: { readonly etagMatches?: string; readonly etagDoesNotMatch?: string };
  readonly httpMetadata?: { readonly contentType?: string };
  readonly customMetadata?: Readonly<Record<string, string>>;
}

export interface R2BucketLike {
  get(key: string): Promise<R2ObjectBodyLike | null>;
  list(options: { prefix: string; cursor?: string; limit?: number }): Promise<R2ListResultLike>;
  put(
    key: string,
    value: string | Uint8Array,
    options?: R2PutOptionsLike,
  ): Promise<R2ObjectLike | null>;
  delete(key: string): Promise<void>;
}

export interface R2BundleOptions {
  readonly bundle: string;
  readonly prefix: string;
}

export interface StoredBundleDocument extends RawBundleDocument {
  readonly revision: Revision;
  readonly customMetadata: Readonly<Record<string, string>>;
}

export interface R2MoveState {
  readonly source: StoredBundleDocument | null;
  readonly destination: StoredBundleDocument | null;
  readonly destinationOwned: boolean;
}

export class R2BundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "R2BundleError";
  }
}

const MARKDOWN_CONTENT_TYPE = "text/markdown; charset=utf-8";
const LIST_LIMIT = 1_000;
const MOVE_FROM = "okf_move_from";
const MOVE_REVISION = "okf_move_revision";
const MOVE_PREVIEW = "okf_move_preview";

export function confinedBundlePath(path: string): string {
  try {
    return validateBundlePath(path);
  } catch (error) {
    throw new R2BundleError(error instanceof Error ? error.message : `unsafe bundle path: ${path}`);
  }
}

function keyPrefix(prefix: string): string {
  const stripped = prefix.replace(/^\/+|\/+$/g, "");
  try {
    validateBundlePath(stripped);
  } catch {
    throw new R2BundleError("R2 bundle prefix must be a confined relative prefix");
  }
  return `${stripped}/`;
}

/**
 * A single OKF bundle mapped to one R2 key prefix. It never discovers or crosses into
 * another bundle.
 */
export class R2BundleAdapter {
  readonly bundle: string;
  readonly prefix: string;

  constructor(
    private readonly bucket: R2BucketLike,
    options: R2BundleOptions,
  ) {
    if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(options.bundle)) {
      throw new R2BundleError("bundle must be a stable lowercase identifier");
    }
    this.bundle = options.bundle;
    this.prefix = keyPrefix(options.prefix);
  }

  key(path: string): string {
    return `${this.prefix}${confinedBundlePath(path)}`;
  }

  async documents(): Promise<readonly RawBundleDocument[]> {
    const documents: RawBundleDocument[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.bucket.list({
        prefix: this.prefix,
        limit: LIST_LIMIT,
        ...(cursor === undefined ? {} : { cursor }),
      });
      for (const object of page.objects) {
        const path = object.key.slice(this.prefix.length);
        if (!path.endsWith(".md")) continue;
        const confined = confinedBundlePath(path);
        const body = await this.bucket.get(object.key);
        if (!body) continue;
        documents.push({ path: confined, content: await body.text(), revision: body.etag });
      }
      cursor = page.truncated ? page.cursor : undefined;
      if (page.truncated && cursor === undefined) {
        throw new R2BundleError("R2 returned a truncated listing without a cursor");
      }
    } while (cursor !== undefined);
    return documents.sort((left, right) => byCodePoint(left.path, right.path));
  }

  async read(path: string): Promise<RawBundleDocument> {
    const stored = await this.readStored(path);
    return { path: stored.path, content: stored.content, revision: stored.revision };
  }

  async readStored(path: string): Promise<StoredBundleDocument> {
    const confined = confinedBundlePath(path);
    const object = await this.bucket.get(this.key(confined));
    if (!object) throw new R2BundleError(`path does not exist in bundle ${this.bundle}: ${confined}`);
    return {
      path: confined,
      content: await object.text(),
      revision: object.etag,
      customMetadata: object.customMetadata ?? {},
    };
  }

  async readStoredIfPresent(path: string): Promise<StoredBundleDocument | null> {
    try {
      return await this.readStored(path);
    } catch (error) {
      if (error instanceof R2BundleError && error.message.includes("does not exist")) return null;
      throw error;
    }
  }

  async create(
    path: string,
    content: string,
    customMetadata?: Readonly<Record<string, string>>,
  ): Promise<Revision> {
    const confined = confinedBundlePath(path);
    const written = await this.bucket.put(this.key(confined), content, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: MARKDOWN_CONTENT_TYPE },
      ...(customMetadata === undefined ? {} : { customMetadata }),
    });
    if (!written) throw new R2BundleError(`path already exists in bundle ${this.bundle}: ${confined}`);
    return written.etag;
  }

  async update(path: string, content: string, expectedRevision: Revision): Promise<Revision> {
    const confined = confinedBundlePath(path);
    const written = await this.bucket.put(this.key(confined), content, {
      onlyIf: { etagMatches: expectedRevision },
      httpMetadata: { contentType: MARKDOWN_CONTENT_TYPE },
    });
    if (!written) throw new R2BundleError(`revision changed before update: ${confined}`);
    return written.etag;
  }

  private moveMetadata(change: Extract<Change, { operation: "move" }>, previewId: string) {
    return {
      [MOVE_FROM]: change.from_path,
      [MOVE_REVISION]: change.expected_revision,
      [MOVE_PREVIEW]: previewId,
    };
  }

  private ownsMoveDestination(
    destination: StoredBundleDocument | null,
    change: Extract<Change, { operation: "move" }>,
    previewId: string,
  ): boolean {
    if (!destination) return false;
    const expected = this.moveMetadata(change, previewId);
    return Object.entries(expected).every(([key, value]) => destination.customMetadata[key] === value);
  }

  async moveState(
    change: Extract<Change, { operation: "move" }>,
    previewId: string,
  ): Promise<R2MoveState> {
    const [source, destination] = await Promise.all([
      this.readStoredIfPresent(change.from_path),
      this.readStoredIfPresent(change.to_path),
    ]);
    return {
      source,
      destination,
      destinationOwned: this.ownsMoveDestination(destination, change, previewId),
    };
  }

  private async compensateMoveDestination(
    change: Extract<Change, { operation: "move" }>,
    previewId: string,
    expectedDestinationRevision: Revision,
  ): Promise<void> {
    const destination = await this.readStoredIfPresent(change.to_path);
    if (
      destination?.revision === expectedDestinationRevision
      && this.ownsMoveDestination(destination, change, previewId)
    ) {
      // R2 has no conditional delete. This bounded re-read is the best available compensation;
      // concurrent delete/move writers still require Durable Object serialization.
      await this.bucket.delete(this.key(change.to_path));
    }
  }

  /**
   * Apply a storage change after semantic preview. R2 supports conditional puts, but not
   * conditional delete or multi-key transactions. Deployments that permit concurrent delete
   * or move writers should serialize this method with a Durable Object.
   */
  async applyStorageChange(
    change: Change,
    previewId?: string,
  ): Promise<Readonly<Record<string, Revision | null>>> {
    if (change.operation === "create") {
      return { [change.path]: await this.create(change.path, change.content) };
    }
    if (change.operation === "update") {
      return { [change.path]: await this.update(change.path, change.content, change.expected_revision) };
    }
    if (change.operation === "delete") {
      const current = await this.read(change.path);
      if (current.revision !== change.expected_revision) {
        throw new R2BundleError(`revision changed before delete: ${change.path}`);
      }
      await this.bucket.delete(this.key(change.path));
      return { [change.path]: null };
    }

    if (!previewId) throw new R2BundleError("move requires its reviewed preview id");
    let state = await this.moveState(change, previewId);
    if (!state.source) {
      if (state.destination && state.destinationOwned) {
        return { [change.from_path]: null, [change.to_path]: state.destination.revision };
      }
      throw new R2BundleError(`move source does not exist: ${change.from_path}`);
    }
    if (state.source.revision !== change.expected_revision) {
      if (state.destination && state.destinationOwned) {
        await this.compensateMoveDestination(change, previewId, state.destination.revision);
      }
      throw new R2BundleError(`revision changed before move: ${change.from_path}`);
    }

    let destinationRevision: Revision;
    if (state.destination) {
      if (!state.destinationOwned) {
        throw new R2BundleError(`move destination already exists: ${change.to_path}`);
      }
      if (state.destination.content !== state.source.content) {
        throw new R2BundleError(`interrupted move destination content changed: ${change.to_path}`);
      }
      destinationRevision = state.destination.revision;
    } else {
      destinationRevision = await this.create(
        change.to_path,
        state.source.content,
        this.moveMetadata(change, previewId),
      );
    }

    state = await this.moveState(change, previewId);
    if (!state.source) {
      return { [change.from_path]: null, [change.to_path]: destinationRevision };
    }
    if (state.source.revision !== change.expected_revision) {
      await this.compensateMoveDestination(change, previewId, destinationRevision);
      throw new R2BundleError(`revision changed during move: ${change.from_path}`);
    }
    // Leave the marked destination in place if delete fails. A stateless retry recognizes the
    // marker and resumes the delete instead of treating its own destination as a conflict.
    await this.bucket.delete(this.key(change.from_path));
    return { [change.from_path]: null, [change.to_path]: destinationRevision };
  }
}
