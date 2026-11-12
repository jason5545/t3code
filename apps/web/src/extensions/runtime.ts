import type { ExtensionsSnapshot, ExtensionWebModule } from "@t3tools/contracts";
import type { ExtensionContribution } from "@t3tools/shared/extensions";
import * as React from "react";
import type { ComponentType } from "react";

/**
 * Fork patch 30: which extensions are off, and what installed extensions added to the slots.
 * The primary environment decides both. The off list is cached on this device so the first
 * paint already leaves those out.
 */
const DISABLED_KEY = "t3code:extensions:disabled:v1";

type SlotContribution = ExtensionContribution<ComponentType<object>>;

export interface ExtensionRuntime {
  readonly disabled: ReadonlySet<string>;
  /** Components that installed extensions added, by slot name. */
  readonly installed: ReadonlyMap<string, ReadonlyArray<SlotContribution>>;
}

/** What an installed extension's web part receives as `t3`. */
interface ExtensionApi {
  readonly react: typeof React;
  readonly slots: {
    readonly add: (slot: string, component: ComponentType<object>) => void;
  };
}

declare global {
  interface Window {
    __t3ExtensionApis?: Map<string, ExtensionApi>;
  }
}

function readCachedDisabled(): ReadonlySet<string> {
  try {
    const cached: unknown = JSON.parse(localStorage.getItem(DISABLED_KEY) ?? "[]");
    return new Set(Array.isArray(cached) ? cached.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

let runtime: ExtensionRuntime = { disabled: readCachedDisabled(), installed: new Map() };
const listeners = new Set<() => void>();
/** The version of each web part that has run on this page. */
const ran = new Map<string, string>();
let contributions: ReadonlyArray<SlotContribution & { readonly slot: string }> = [];

function subscribeExtensionRuntime(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const readExtensionRuntime = () => runtime;

export function useExtensionRuntime() {
  return React.useSyncExternalStore(subscribeExtensionRuntime, readExtensionRuntime);
}

// The desktop app's CSP allows inline scripts but not `blob:` or `eval`, so a web part runs
// as an inline script that is handed its API through a global.
function runWebModule({ id, version, code }: ExtensionWebModule) {
  if (ran.get(id) === version) return;
  ran.set(id, version);
  contributions = contributions.filter((contribution) => contribution.id !== id);
  const apis = (window.__t3ExtensionApis ??= new Map());
  apis.set(id, {
    react: React,
    slots: {
      add: (slot, contribution) => {
        contributions = [...contributions, { id, slot, contribution }];
      },
    },
  });
  const script = document.createElement("script");
  const key = JSON.stringify(id);
  script.textContent = `(function (t3) { try {\n${code}\n} catch (error) { console.error("Extension " + ${key} + " failed to load.", error); } })(window.__t3ExtensionApis.get(${key}));`;
  document.head.append(script);
  script.remove();
}

/** Takes the primary environment's answer: what is off, and the web parts to run. */
export function applyExtensionsSnapshot(snapshot: ExtensionsSnapshot) {
  const disabled = new Set(snapshot.extensions.flatMap(({ id, enabled }) => (enabled ? [] : [id])));
  try {
    localStorage.setItem(DISABLED_KEY, JSON.stringify([...disabled]));
  } catch {
    // Storage is full or blocked; the next load asks the environment again anyway.
  }
  let installed = runtime.installed;
  if (snapshot.webModules !== null) {
    for (const module of snapshot.webModules) runWebModule(module);
    // A removed or turned-off extension is no longer among the web parts.
    const active = new Set(snapshot.webModules.map(({ id }) => id));
    const bySlot = new Map<string, Array<SlotContribution>>();
    for (const { slot, id, contribution } of contributions) {
      if (!active.has(id)) continue;
      bySlot.set(slot, [...(bySlot.get(slot) ?? []), { id, contribution }]);
    }
    installed = bySlot;
  }
  runtime = { disabled, installed };
  for (const listener of listeners) listener();
}
