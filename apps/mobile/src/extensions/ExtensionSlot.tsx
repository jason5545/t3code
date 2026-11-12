import type { ExtensionContribution, ExtensionHost } from "@t3tools/shared/extensions";
import type { ComponentType } from "react";

/** A host's points when each one is a slot: the components that take that slot's props. */
export type SlotComponents<Slots> = {
  readonly [Slot in keyof Slots]: ComponentType<Slots[Slot]>;
};

/** The component an upstream file renders: a slot's contributions, or nothing when none. */
export function createExtensionSlot<Slots>(host: ExtensionHost<SlotComponents<Slots>>) {
  return function ExtensionSlot<Slot extends keyof Slots>({
    name,
    ...props
  }: { readonly name: Slot } & Slots[Slot]) {
    // The call site checks the slot's props; each of the slot's components takes exactly those.
    const contributions = host.list(name) as ReadonlyArray<
      ExtensionContribution<ComponentType<object>>
    >;
    return contributions.map(({ contribution: Contribution }, index) => (
      // oxlint-disable-next-line react/no-array-index-key -- the manifest order never changes
      <Contribution key={index} {...props} />
    ));
  };
}
