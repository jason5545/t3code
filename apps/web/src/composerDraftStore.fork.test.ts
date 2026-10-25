import {
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  DraftId,
  partializeComposerDraftStoreState,
  setDraftSessionEphemeral,
  setEphemeralThreadKeys,
  useComposerDraftStore,
} from "./composerDraftStore";

const environmentId = EnvironmentId.make("environment-local");

function setup() {
  useComposerDraftStore.setState({
    draftsByThreadKey: {},
    draftThreadsByThreadKey: {},
    logicalProjectDraftThreadKeyByLogicalProjectKey: {},
    ephemeralThreadKeys: new Set(),
  });
}

describe("ephemeral composer drafts (fork patch 11)", () => {
  it("keeps ephemeral drafts out of storage and others in it", () => {
    setup();
    const store = useComposerDraftStore.getState();
    const projectRef = scopeProjectRef(environmentId, ProjectId.make("scratch"));
    const ephemeralDraft = DraftId.make("draft-ephemeral");
    const keptThread = scopeThreadRef(environmentId, ThreadId.make("thread-kept"));
    const ephemeralThread = scopeThreadRef(environmentId, ThreadId.make("thread-ephemeral"));
    store.setProjectDraftThreadId(projectRef, ephemeralDraft, {
      threadId: ThreadId.make("thread-new"),
    });
    store.setPrompt(ephemeralDraft, "secret new thread text");
    setDraftSessionEphemeral(ephemeralDraft, true);
    store.setPrompt(ephemeralThread, "secret follow-up text");
    setEphemeralThreadKeys(new Set([scopedThreadKey(ephemeralThread)]));
    store.setPrompt(keptThread, "kept text");

    const persisted = partializeComposerDraftStoreState(useComposerDraftStore.getState());

    expect(JSON.stringify(persisted)).not.toContain("secret");
    expect(persisted.draftsByThreadKey[scopedThreadKey(keptThread)]?.prompt).toBe("kept text");
  });

  it("persists a new-thread draft again once it is no longer ephemeral", () => {
    setup();
    const store = useComposerDraftStore.getState();
    const projectRef = scopeProjectRef(environmentId, ProjectId.make("scratch"));
    const draftId = DraftId.make("draft-toggled");
    store.setProjectDraftThreadId(projectRef, draftId, { threadId: ThreadId.make("thread-new") });
    store.setPrompt(draftId, "ordinary text");
    setDraftSessionEphemeral(draftId, true);
    setDraftSessionEphemeral(draftId, false);

    const persisted = partializeComposerDraftStoreState(useComposerDraftStore.getState());

    expect(persisted.draftsByThreadKey[draftId]?.prompt).toBe("ordinary text");
  });
});
