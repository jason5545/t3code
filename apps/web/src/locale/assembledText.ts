import { useChinese } from "./autoTranslateRuntime";

/*
 * Sentences built around identifiers. The build-time pass keeps a template's values as they are,
 * so these helpers pick the language instead.
 */

/** The interface switch button's label; a null title is the standard interface. */
export function interfaceSwitchLabel(title: string | null): string {
  if (useChinese) return title === null ? "切換到標準介面" : `切換到「${title}」`;
  return title === null ? "Switch to the standard interface" : `Switch to ${title}`;
}
