/**
 * Fork patch 11: the new-thread switch to start an ephemeral thread. Offered
 * only for No project on an OMP instance with a local model; leaving that
 * combination clears it, so the server never gets a launch it refuses.
 */
import { useEffect } from "react";

import {
  type DraftId,
  setDraftSessionEphemeral,
  useComposerDraftStore,
} from "../../composerDraftStore";
import { Badge } from "../ui/badge";
import { Toggle } from "../ui/toggle";

export function EphemeralDraftToggle(props: {
  readonly draftId: DraftId | null;
  readonly available: boolean;
}) {
  const { draftId, available } = props;
  const pressed = useComposerDraftStore(
    (store) => draftId !== null && store.getDraftSession(draftId)?.ephemeral === true,
  );
  // oxlint-disable-next-line t3code/react-effect-budget -- launch reads the stored draft flag, so clear it when the model loses local support.
  useEffect(() => {
    if (!available && pressed && draftId !== null) setDraftSessionEphemeral(draftId, false);
  }, [available, pressed, draftId]);
  if (!available || draftId === null) return null;
  return (
    <Toggle
      variant="pill"
      size="xs"
      pressed={pressed}
      onPressedChange={(next) => setDraftSessionEphemeral(draftId, next)}
      aria-label="Ephemeral thread"
      title="Nothing is kept once the conversation ends"
    >
      Ephemeral
    </Toggle>
  );
}

/** Marks an ephemeral thread wherever its title shows. */
export function EphemeralThreadBadge() {
  return (
    <Badge variant="info" size="sm">
      Ephemeral
    </Badge>
  );
}
