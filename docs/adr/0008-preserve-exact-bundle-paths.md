# Preserve exact Bundle paths across adapters

Bundle paths are confined, Bundle-relative POSIX strings. The toolkit rejects
empty paths, NUL, absolute paths, backslashes, empty segments, and `.` or `..`
segments. Document operations additionally require the exact path to end in
`.md`.

Adapters preserve every other code point exactly. They do not trim whitespace
or apply Unicode normalization. OKF v0.2 does not define a normalization form,
and filesystems and object stores can distinguish canonically equivalent names.
Rewriting a path would let the same reviewed change digest address a different
storage key. Preview IDs, integrity manifests, filesystem paths, and R2 keys
therefore bind the exact authored string.
