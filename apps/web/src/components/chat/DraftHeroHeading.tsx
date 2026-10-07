import type { ReactNode } from "react";
import { useLocale } from "~/locale/LocaleProvider";
import type { TranslationKey } from "~/locale/messages";

interface DraftHeroHeadingProps {
  readonly isScratchDraft: boolean;
  readonly hasResolvedProject: boolean;
  readonly canChooseProject: boolean;
  readonly projectDisplayName: string | null;
  readonly projectSelector: ReactNode;
}

/** Keep the project picker interactive while letting each locale order the sentence. */
export function DraftHeroHeading({
  isScratchDraft,
  hasResolvedProject,
  canChooseProject,
  projectDisplayName,
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
  const headingLabel = t(key, { project: projectDisplayName ?? t("Choose a project") });
  // Split only the trusted translation template, never the user's project name.
  const [beforeProject, afterProject] = t(key).split("{project}");
  return (
    <h1
      aria-label={headingLabel}
      className="w-full text-center font-normal text-2xl text-foreground tracking-tight sm:text-3xl"
    >
      {beforeProject}
      {afterProject === undefined ? null : (
        <>
          {projectSelector}
          {afterProject}
        </>
      )}
    </h1>
  );
}
