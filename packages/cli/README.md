# okf-cli

`okf-cli` installs the `okf` binary. The CLI writes deterministic JSON by
default and accepts `--json` so calling programs can state the contract
explicitly. Every command operates on exactly one bundle.

```sh
okf inspect docs --json
okf validate docs --strict
okf search docs "box office"
okf read docs concepts/settlement.md
okf visualize docs --out .okf/viz.html
okf watch docs --out .okf/viz.html
```

When a target is a repository rather than a bundle root, discovery uses only
`.agents/okf.yaml`. Use `--bundle NAME` when the manifest declares more than one
bundle.

## Change operations

Changes are JSON on standard input by default, or from `--input FILE`. Preview
the exact file, review its diff and diagnostics, then pass its `preview_id` to
apply:

```sh
okf change preview docs --input change.json
okf change apply docs --input change.json --preview-id sha256:REVIEWED_ID
```

The accepted operations are `create`, `update`, `delete`, and `move`. Updates,
deletes, and moves require `expected_revision`. Apply rejects a missing or
mismatched preview ID before mutation. It then validates the proposed bundle,
rechecks live filesystem state, writes the change to disk, and validates the
result. Repeating an accepted request returns `unchanged` if the requested state
already exists.

## Consumer profiles

The base CLI has no named profile registry and rejects `--profile NAME`.
Trusted local wrappers can explicitly pass `--profile-module FILE`, where the
built JavaScript module exports a `profile` object compatible with
`okf-core`'s `ValidationProfile`. Hosted consumers compose profiles directly in
code. The CLI never executes validation command arrays from a manifest.

## Exit status

- `0`: command completed, validation passed, or a change was applied/unchanged.
- `1`: validation failed or a change preview/apply was rejected.
- `2`: arguments, I/O, configuration, or input were invalid. The error is JSON
  on standard error.
