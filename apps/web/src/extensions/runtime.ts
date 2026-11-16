import type { ExtensionsSnapshot, ExtensionWebModule } from "@t3tools/contracts";
import type { ExtensionContribution } from "@t3tools/shared/extensions";
import * as React from "react";
import type { ComponentType } from "react";

import { selectionAfterExtensionList } from "./interfaceSwitch";

/**
 * Fork patch 30: which extensions are off, and what installed extensions added to the slots.
 * The primary environment decides both. The off list is cached on this device so the first
 * paint already leaves those out.
 */
const DISABLED_KEY = "t3code:extensions:disabled:v1";
/** The interface this device last switched to: the id of the extension that offers it. */
const INTERFACE_KEY = "t3code:extensions:interface:v1";

type SlotContribution = ExtensionContribution<ComponentType<object>>;

export interface ExtensionRuntime {
  readonly disabled: ReadonlySet<string>;
  /** Components that installed extensions added, by slot name. */
  readonly installed: ReadonlyMap<string, ReadonlyArray<SlotContribution>>;
  /** Extension titles by id, known once the primary environment has answered. */
  readonly titles: ReadonlyMap<string, string>;
  /** The extension whose interface is chosen on this device, or null for the standard one. */
  readonly selectedInterface: string | null;
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

function readSelectedInterface(): string | null {
  try {
    return localStorage.getItem(INTERFACE_KEY);
  } catch {
    return null;
  }
}

let runtime: ExtensionRuntime = {
  disabled: readCachedDisabled(),
  installed: new Map(),
  titles: new Map(),
  selectedInterface: readSelectedInterface(),
};
const listeners = new Set<() => void>();
/** The version of each web part that has run on this page. */
const ran = new Map<string, string>();
let contributions: ReadonlyArray<SlotContribution & { readonly slot: string }> = [];
/** What the web parts that ran last were read from, so a re-read can tell whether to fetch them. */
let appliedList: string | null = null;

/** The extension list as one string: a change in it means the web parts may have changed. */
export const extensionListKey = (snapshot: ExtensionsSnapshot) =>
  snapshot.extensions.map(({ id, version, enabled }) => `${id}@${version}:${enabled}`).join(",");

export const appliedExtensionListKey = () => appliedList;

function subscribeExtensionRuntime(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const readExtensionRuntime = () => runtime;

export function useExtensionRuntime() {
  return React.useSyncExternalStore(subscribeExtensionRuntime, readExtensionRuntime);
}

/** Switches this device to an extension's interface, or back to the standard one with null. */
export function selectExtensionInterface(id: string | null) {
  try {
    if (id === null) localStorage.removeItem(INTERFACE_KEY);
    else localStorage.setItem(INTERFACE_KEY, id);
  } catch {
    // Storage is full or blocked; the choice still holds until the page reloads.
  }
  runtime = { ...runtime, selectedInterface: id };
  for (const listener of listeners) listener();
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
    appliedList = extensionListKey(snapshot);
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
  const titles = new Map(snapshot.extensions.map(({ id, title }) => [id, title]));
  const selectedInterface = selectionAfterExtensionList(
    runtime.selectedInterface,
    snapshot.extensions,
  );
  if (selectedInterface !== runtime.selectedInterface) selectExtensionInterface(selectedInterface);
  runtime = { ...runtime, disabled, installed, titles };
  for (const listener of listeners) listener();
}
