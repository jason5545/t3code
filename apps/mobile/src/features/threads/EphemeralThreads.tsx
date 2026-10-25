/**
 * Fork patch 11: ephemeral threads on mobile — the new-thread toggle and the
 * row marker.
 */
import { isEphemeralThreadShell } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { useEffect } from "react";
import { Text } from "react-native";

import { ComposerInlineControl } from "../../components/ComposerToolbar";
import { setComposerDraftEphemeral, useComposerDraft } from "../../state/use-composer-drafts";

export function EphemeralNewTaskToggle(props: {
  readonly draftKey: string | null;
  readonly available: boolean;
  readonly disabled?: boolean;
}) {
  const { draftKey, available } = props;
  const ephemeral = useComposerDraft(draftKey).ephemeral === true;
  useEffect(() => {
    if (!available && ephemeral && draftKey !== null) setComposerDraftEphemeral(draftKey, false);
  }, [available, ephemeral, draftKey]);
  if (!available || draftKey === null) return null;
  return (
    <ComposerInlineControl
      accessibilityLabel="Ephemeral thread"
      accessibilityHint="Nothing is kept once the conversation ends"
      disabled={props.disabled}
      icon="eye.slash"
      label="Ephemeral"
      selected={ephemeral}
      showChevron={false}
      onPress={() => setComposerDraftEphemeral(draftKey, !ephemeral)}
    />
  );
}

/** Nested in a row's title text so the marker wraps with it. */
export function EphemeralTitleMarker(props: { readonly thread: EnvironmentThreadShell }) {
  if (!isEphemeralThreadShell(props.thread)) return null;
  return (
    <>
      <Text className="text-primary">Ephemeral</Text>
      {" · "}
    </>
  );
}
