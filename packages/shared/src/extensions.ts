/**
 * Fork extension kernel (patches.md "Extension system"). A surface declares its extension points
 * as one interface, lists its extensions in a manifest, and upstream files read contributions
 * from the host that manifest builds. Contributions are static values: an extension module must
 * not use, while it loads, anything from the upstream file that reads its point.
 */
export interface ExtensionInfo {
  readonly id: string;
  readonly title: string;
  /** The patches.md section that documents it. */
  readonly patch: number;
}

export interface Extension<Points> extends ExtensionInfo {
  readonly contributes: { readonly [Point in keyof Points]?: ReadonlyArray<Points[Point]> };
}

export interface ExtensionContribution<Contribution> {
  /** The extension it comes from, so a host can leave out a disabled one. */
  readonly id: string;
  readonly contribution: Contribution;
}

export interface ExtensionHost<Points> {
  readonly extensions: ReadonlyArray<ExtensionInfo>;
  /** A point's contributions in manifest order. The array is the same one on every call. */
  readonly list: <Point extends keyof Points>(
    point: Point,
  ) => ReadonlyArray<ExtensionContribution<Points[Point]>>;
}

export function createExtensionHost<Points>(
  extensions: ReadonlyArray<Extension<Points>>,
): ExtensionHost<Points> {
  const ids = new Set<string>();
  for (const { id } of extensions) {
    if (ids.has(id)) throw new Error(`Extension "${id}" is listed twice.`);
    ids.add(id);
  }
  const lists: {
    [Point in keyof Points]?: ReadonlyArray<ExtensionContribution<Points[Point]>>;
  } = {};
  return {
    extensions,
    list: (point) =>
      (lists[point] ??= extensions.flatMap(({ id, contributes }) =>
        (contributes[point] ?? []).map((contribution) => ({ id, contribution })),
      )),
  };
}
