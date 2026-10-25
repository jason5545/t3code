import type { TextSelectionMenuConfig } from "react-native-enriched-markdown";

import { useChinese } from "../locale/autoTranslateRuntime";

let config: TextSelectionMenuConfig | undefined;

/**
 * enriched-markdown relabels the system Copy item with its own English default on Android, so the
 * selection menu passes labels explicitly.
 */
export function markdownSelectionMenuConfig(): TextSelectionMenuConfig {
  if (config) return config;
  const copyLabel = "Copy";
  const copyAsMarkdownLabel = "Copy as Markdown";
  const copyImageUrlLabel = "Copy Image URL";
  // The build-time pass skips literals with braces; native fills in {count}.
  const imageUrlsTemplate = useChinese ? "複製 {count} 個圖片網址" : "Copy {count} Image URLs";
  config = {
    copy: { label: copyLabel },
    copyAsMarkdown: { label: copyAsMarkdownLabel },
    copyImageUrl: { label: copyImageUrlLabel, pluralLabels: { other: imageUrlsTemplate } },
  };
  return config;
}
