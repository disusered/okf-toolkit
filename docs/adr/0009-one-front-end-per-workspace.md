# Publish one front end per workspace

Each workspace that keeps an OKF Bundle publishes exactly one HTTPS MCP front end
for it. The front end is assembled from four parts: the `okf_v1_*` surface from
`okf-contracts`, a storage adapter (filesystem through `okf-node`, R2 through
`okf-cloudflare`), a host (a Node process or a Worker), and an edge (Cloudflare
Access as the OAuth authorization server). Only the storage adapter and the host
vary, so every consumer of a front end sees the same tools wherever the bytes sit.

Authentication belongs to the edge. A Node host listens on loopback behind a
tunnel and carries no authentication code. A Worker is reachable on the edge and
decides authorship from the caller's email, so it verifies the Access assertion
with `accessAuthorizer`. Consumers still choose and compose that policy; the
toolkit only supplies the shared implementation.
