/** Fork patch 11: asked before every ephemeral delete, whatever the confirmation setting says. */
export function ephemeralDeleteConfirmation(): string {
  return "Delete this ephemeral thread? Its conversation is erased at once and cannot be recovered.";
}
