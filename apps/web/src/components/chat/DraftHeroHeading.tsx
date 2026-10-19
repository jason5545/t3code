import type { ReactNode } from "react";
import { useLocale } from "~/locale/LocaleProvider";
import type { TranslationKey } from "~/locale/messages";

interface DraftHeroHeadingProps {
  readonly isScratchDraft: boolean;
  readonly hasResolvedProject: boolean;
  readonly canChooseProject: boolean;
  readonly projectSelector: ReactNode;
}

/** Keep the project picker interactive while letting each locale order the sentence. */
export function DraftHeroHeading({
  isScratchDraft,
  hasResolvedProject,
  canChooseProject,
  projectSelector,
}: DraftHeroHeadingProps) {
  const { t } = useLocale();
  const key: TranslationKey = isScratchDraft
    ? "What should we work on?"
    : hasResolvedProject
      ? "What should we build in {project}?"
      : canChooseProject
        ? "{project} to start"
        : "Add a project to start";
  // Split only the trusted translation template, never the user's project name.
  const [beforeProject, afterProject] = t(key).split("{project}");
  return (
    // An explicit heading label hides the inline project picker in NVDA browse mode.
    <h1 className="w-full text-center font-normal text-2xl text-foreground tracking-tight sm:text-3xl">
      {beforeProject}
      {afterProject === undefined ? null : (
        // The trailing text stays on the project name's line, like upstream's
        // non-breaking wrapper around the picker and its question mark.
        <span className={hasResolvedProject ? "whitespace-nowrap" : undefined}>
          {projectSelector}
          {afterProject}
        </span>
      )}
    </h1>
  );
}
