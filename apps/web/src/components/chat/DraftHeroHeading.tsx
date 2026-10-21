import type { ReactNode } from "react";
import { useChinese } from "~/locale/autoTranslateRuntime";
import { DraftHeroProjectHeading } from "./DraftHeroProjectHeading";

/**
 * Stands in for upstream's heading for a resolved project. English keeps it: it moves
 * a long project name onto its own line, and that fixed English word order cannot carry
 * a translated sentence, so zh-TW renders one sentence around the interactive picker.
 */
export function DraftHeroHeading(props: { children: ReactNode; projectName: string }) {
  return localizedHeading(props);
}

// A component may not read `useChinese`: the hooks lint rule takes it for a hook.
function localizedHeading({
  children,
  projectName,
}: {
  children: ReactNode;
  projectName: string;
}): ReactNode {
  if (!useChinese) {
    return <DraftHeroProjectHeading projectName={projectName}>{children}</DraftHeroProjectHeading>;
  }
  return (
    // An explicit heading label hides the inline project picker in NVDA browse mode.
    <h1 className="w-full text-center font-normal text-2xl text-foreground tracking-tight sm:text-3xl">
      {"想在 "}
      {/* The question stays on the project name's line, like upstream's non-breaking wrapper. */}
      <span className="whitespace-nowrap">
        {children}
        {" 做些什麼？"}
      </span>
    </h1>
  );
}
