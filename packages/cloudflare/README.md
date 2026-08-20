# okf-cloudflare

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
