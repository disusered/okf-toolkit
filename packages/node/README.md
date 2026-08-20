# okf-node

`okf-node` runs the storage-neutral `okf-core` analysis on a confined local
filesystem bundle. It reads UTF-8 Markdown without following symlinks, emits
opaque content revisions, resolves the singular `.agents/okf.yaml` manifest,
previews and applies revision-checked changes, and watches one bundle.

```ts
import { FilesystemBundle } from "okf-node";

const bundle = await FilesystemBundle.open("docs");
const analysis = await bundle.analyze();
```

Every path supplied to a bundle operation is relative to that bundle. The
adapter rejects absolute paths, backslashes, empty segments, `.` and `..`. A
bundle operation never reads, resolves, searches, or writes a second bundle.

## Manifest discovery

Discovery checks only `.agents/okf.yaml` in the target directory and its
ancestors. A manifest can describe several bundles, but each call selects one:

```yaml
schema_version: 1
adapter: iteramind
instructions:
  common:
    - AGENTS.md
    - CONTEXT.md
  bundles:
    private:
      - knowledge/private/runbooks/maintain-private-corpus.md
bundles:
  private:
    root: knowledge/private
    index: index.md
    audience: Carlos-only company context
    access: read-write
```

There is no local registry and no cross-bundle lookup.

## Changes

`previewChange` accepts the versioned `Change` union and returns the SHA-256 ID
of its recursively key-sorted canonical JSON. `applyChange` requires an
`ApplyChangeRequest` containing that exact `change` and `preview_id`. The ID is
independent of process state, so a different process or fresh bundle adapter can
apply reviewed input. Any change to the reviewed fields changes the ID.

Updates, deletes, and moves require the opaque `expected_revision` returned by
a prior read. Apply validates the proposed bundle, rechecks live revisions and
destinations, writes the change, and validates the result. A repeated request
returns `unchanged` if the requested bytes are already present or the delete or
move is complete. An interrupted move with matching source and destination
finishes the source deletion.

Local writes sync file contents and affected parent directories. Updates use a
same-directory temporary file and rename. Moves create an exclusive hard link,
sync its parent, and then delete the source, so there is a brief interval with
two names for the same inode. If a move returns `EXDEV`, the adapter reports a
conflict instead of copying and deleting across filesystems. If post-write
validation fails, it restores the original bytes and mode and syncs the
rollback.

Because POSIX path APIs do not provide an atomic compare-and-swap across a
revision check and rename or unlink, independent writers still require external
serialization. Some operating systems do not support directory fsync. On those
systems, the adapter ignores only the documented unsupported errors. A
concurrent writer can also prevent cleanup of an empty parent directory created
for an operation.
