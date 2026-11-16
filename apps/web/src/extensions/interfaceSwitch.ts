/** Fork: which interface the window draws (patches.md "Extension system"). Null is the standard one. */
export interface InterfaceSwitchState {
  readonly activeId: string | null;
  /** Where the switch button leads: the standard interface, then each offered one, in turn. */
  readonly nextId: string | null;
}

/** Null when no extension offers an interface: the standard one is drawn and there is no button. */
export function resolveInterfaceSwitch(
  offered: ReadonlyArray<string>,
  selected: string | null,
): InterfaceSwitchState | null {
  if (offered.length === 0) return null;
  const activeId = selected !== null && offered.includes(selected) ? selected : null;
  const order: ReadonlyArray<string | null> = [null, ...offered];
  return { activeId, nextId: order[(order.indexOf(activeId) + 1) % order.length] ?? null };
}

/**
 * The selection once the environment has listed its extensions. One that is turned off or
 * removed takes its interface with it, so turning it back on shows the button, not the interface.
 */
export function selectionAfterExtensionList(
  selected: string | null,
  extensions: ReadonlyArray<{ readonly id: string; readonly enabled: boolean }>,
): string | null {
  return extensions.some(({ id, enabled }) => enabled && id === selected) ? selected : null;
}
