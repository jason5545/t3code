/** Fork patch 11: Android only; iOS has no flag that keeps the screen out of captures. */
export function SecureWindow(_props: { readonly active: boolean }) {
  return null;
}
