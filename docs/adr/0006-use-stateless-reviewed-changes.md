# Use stateless reviewed changes

Writes use a versioned create, update, delete, or move Change plus opaque
document revisions. Preview is deterministic and read-only, while apply
rechecks the preview digest, revisions, destination absence, and resulting
Bundle validation. The process does not retain a proposal or require a
bundle-wide transaction. The same change lifecycle therefore works after a
filesystem or R2 process restarts.
