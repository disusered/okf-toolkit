import { watch, type FSWatcher } from "node:fs";
import type { BundleAnalysis } from "okf-contracts";
import { byCodePoint, type AnalyzeBundleOptions } from "okf-core";
import type { FilesystemBundle } from "./filesystem.js";

export interface BundleWatchEvent {
  readonly schema: "okf.watch.v1";
  readonly changed: readonly string[];
  readonly analysis: BundleAnalysis;
}

export interface WatchBundleOptions {
  readonly debounceMs?: number;
  readonly analyze?: AnalyzeBundleOptions;
  readonly signal?: AbortSignal;
}

export function watchBundle(
  bundle: FilesystemBundle,
  handler: (event: BundleWatchEvent) => void | Promise<void>,
  options: WatchBundleOptions = {},
): FSWatcher {
  const changed = new Set<string>();
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let rerun = false;

  const flush = async (): Promise<void> => {
    timer = undefined;
    if (running) {
      rerun = true;
      return;
    }
    running = true;
    try {
      const paths = [...changed].sort(byCodePoint);
      changed.clear();
      await handler({
        schema: "okf.watch.v1",
        changed: paths,
        analysis: await bundle.analyze(options.analyze),
      });
    } finally {
      running = false;
      if (rerun || changed.size > 0) {
        rerun = false;
        timer = setTimeout(() => void flush(), options.debounceMs ?? 75);
      }
    }
  };

  const watcher = watch(
    bundle.root,
    { recursive: true, signal: options.signal, persistent: true },
    (_eventType, filename) => {
      if (filename === null) {
        changed.add("*");
      } else {
        const documentPath = filename.split("\\").join("/");
        if (!documentPath.endsWith(".md")) {
          return;
        }
        changed.add(documentPath);
      }
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => void flush(), options.debounceMs ?? 75);
    },
  );
  watcher.once("close", () => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  });
  return watcher;
}
