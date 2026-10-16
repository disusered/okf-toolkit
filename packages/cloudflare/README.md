# okf-cloudflare

## Generated directory navigation

`createR2OkfV1Operations` exposes `okf_v1_index({ bundle, path: "." })`.
By default it generates navigation from live bundle analysis. Consumers that
precompute views can provide `indexes: async () => storedIndexesOrNull` to
serve a generated snapshot; `null` falls back to live analysis.

In `onApplied`, call `generateBundleIndexes(analysis)` from `okf-core` and
persist the result outside the authored prefix. Reuse that same snapshot in
the reader payload. Explicit rebuilds must call the generator too, using the
documents already loaded. Generated navigation never becomes authored content
or semantic graph edges. The consumer owns regeneration and failure reporting.

Use this package to run exactly one OKF Bundle on Cloudflare. It provides an R2
adapter, the versioned `okf_v1_*` MCP operations, hooks for Cloudflare Access
and authorization, and a Queue consumer that safely handles repeated delivery
while rebuilding deterministic visualizations.

```ts
import {
  createApplyChangeDurableObject,
  durableObjectStubForBundle,
  createOkfV1Worker,
  createR2OkfV1Operations,
  createVisualizationQueueWorker,
  R2BundleAdapter,
  withDurableObjectApply,
} from "okf-cloudflare";
```

You configure identity, authorization, Bundle and Profile selection, Worker
bindings, routes, and observability. The package accesses only its configured
Bundle. R2 supports conditional puts but not conditional deletes or multi-key
transactions. To handle concurrent delete or move writers, serialize apply
operations with the package's Bundle-named Durable Object coordinator. An
author allowlist cannot serialize writes.

```ts
function directOperations(env: Env) {
  const adapter = new R2BundleAdapter(env.OKF_BUCKET, {
    bundle: "shared",
    prefix: "shared",
  });
  return createR2OkfV1Operations({ adapter });
}

export const SharedOkfApply = createApplyChangeDurableObject<Env>({
  apply(request, env) {
    return directOperations(env).applyChange(request);
  },
});

function operations(env: Env) {
  return withDurableObjectApply(
    directOperations(env),
    durableObjectStubForBundle(env.OKF_APPLY, "shared"),
  );
}
```

Bind and migrate the Durable Object class, and route every writer for a Bundle
through the same namespace and Bundle name. Reads and previews use the direct
R2 operations.

Pass the visualization generator to the Queue consumer. Use `okf-core` and
`okf-viz` so local and hosted projections consume the same Bundle Analysis.

## Access and Worker helpers

A Worker behind Cloudflare Access verifies the assertion Access forwards, so it
knows who is calling and can decide who may apply changes:

```ts
import {
  accessAuthorizer,
  createOkfV1Worker,
  healthResponse,
  HEALTH_PATH,
  logError,
  requiredEnv,
} from "okf-cloudflare";

const worker = createOkfV1Worker<Env>({
  name: "example-knowledge",
  version: env.RELEASE_VERSION,
  title: "Example Knowledge",
  purpose: "Example's shared knowledge: decisions, policies, and runbooks.",
  async authorize(request, env) {
    return accessAuthorizer({
      teamDomain: requiredEnv(env, "CF_ACCESS_TEAM_DOMAIN"),
      audience: requiredEnv(env, "CF_ACCESS_AUD"),
    })(request);
  },
  // bundle, visualizationKey, bucket, canApply, operations
});
```

- `accessAuthorizer` checks the `Cf-Access-Jwt-Assertion` signature against the
  team's published keys, the issuer, the audience, and expiry. It returns the
  subject and the lowercased email, or `null` for any failure, without saying
  why.
- `healthResponse` answers `GET /healthz` with `{status, service, version}`.
- `requiredEnv` reads a trimmed setting and throws `ConfigurationError` when it
  is missing.
- `logError` writes one structured line naming the event and the error class,
  never its message.
- `withMcpAccept` widens a request's `Accept` to what the streamable HTTP
  transport requires, for gateways that send only one of the two types.
  `createOkfV1Worker` applies it to every MCP request.

