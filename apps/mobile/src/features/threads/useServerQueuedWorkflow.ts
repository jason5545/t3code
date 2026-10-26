import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { ThreadQueueWorkflowState } from "@t3tools/client-runtime/state/thread-workflows";
import { Atom } from "effect/reactivity";

import { environmentThreadDetails } from "../../state/threads";

const EMPTY_QUEUE_WORKFLOW_ATOM = Atom.make<ThreadQueueWorkflowState | null>(null).pipe(
  Atom.withLabel("mobile-server-queued-feed:empty"),
);

export function useServerQueuedWorkflow(ref: ScopedThreadRef | null | undefined) {
  return useAtomValue(
    ref ? environmentThreadDetails.queueWorkflowAtom(ref) : EMPTY_QUEUE_WORKFLOW_ATOM,
  );
}
