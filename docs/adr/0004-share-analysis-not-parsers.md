# Share one bundle-analysis contract

All APIs, the JSON CLI, MCP tools, and the visualizer consume the same
versioned Bundle Analysis produced by `okf-core`. Adapters supply bytes and
consumer Profiles add policy, but they do not reimplement frontmatter parsing,
Markdown links, graph construction, or diagnostics. This keeps the local and
R2 forms from becoming different OKF dialects.
