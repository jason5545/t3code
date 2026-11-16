import { createContext, useContext } from "react";

/**
 * Fork patch 30, API 4: an interface that sends messages its own way draws `CurrentPage` with
 * `composer: false`. ChatView then leaves out an open thread's composer while nothing waits on the
 * user; an approval or a question still shows it, and so does a new thread's draft.
 */
export const ExtensionHidesComposer = createContext(false);

export const useExtensionHidesComposer = () => useContext(ExtensionHidesComposer);
