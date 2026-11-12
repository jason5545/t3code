import type { ExtensionContribution, ExtensionHost } from "@t3tools/shared/extensions";
import { Component, type ComponentType, type ReactNode } from "react";

import { useExtensionRuntime } from "./runtime";

/** A host's points when each one is a slot: the components that take that slot's props. */
export type SlotComponents<Slots> = {
  readonly [Slot in keyof Slots]: ComponentType<Slots[Slot]>;
};

const NONE: ReadonlyArray<ExtensionContribution<ComponentType<object>>> = [];

/** An installed extension that throws while drawing leaves its slot empty, not the app broken. */
class InstalledExtensionBoundary extends Component<
  { readonly children: ReactNode },
  { readonly failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * The component an upstream file renders: the slot's built-in contributions that are on, then
 * what installed extensions added to it. Nothing when there are none.
 */
export function createExtensionSlot<Slots>(host: ExtensionHost<SlotComponents<Slots>>) {
  return function ExtensionSlot<Slot extends keyof Slots & string>({
    name,
    ...props
  }: { readonly name: Slot } & Slots[Slot]) {
    const { disabled, installed } = useExtensionRuntime();
    // The call site checks the slot's props; each of the slot's components takes exactly those.
    const builtIn = host.list(name) as ReadonlyArray<ExtensionContribution<ComponentType<object>>>;
    return (
      <>
        {builtIn.map(({ id, contribution: Contribution }, index) =>
          disabled.has(id) ? null : (
            // oxlint-disable-next-line react/no-array-index-key -- the manifest order never changes
            <Contribution key={index} {...props} />
          ),
        )}
        {(installed.get(name) ?? NONE).map(({ id, contribution: Contribution }, index) => (
          // oxlint-disable-next-line react/no-array-index-key -- an extension adds in a fixed order
          <InstalledExtensionBoundary key={`${id}:${index}`}>
            <Contribution {...props} />
          </InstalledExtensionBoundary>
        ))}
      </>
    );
  };
}
