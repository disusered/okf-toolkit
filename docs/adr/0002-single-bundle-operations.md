# Keep every operation within one bundle

Every read, search, validation, graph, visualization, preview, and apply targets
one bundle. Storage adapters can differ, but the toolkit never resolves links,
combines results, or mutates across bundles. Any future multi-bundle interface
must be separately versioned and read-only.
