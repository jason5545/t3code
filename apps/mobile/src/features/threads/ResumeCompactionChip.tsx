import { View } from "react-native";

import { Chip } from "../../components/ui/Chip";
import { useChinese } from "../../locale/autoTranslateRuntime";

/** Fork patch 26: web's "When you return" compaction for the next mobile send. */
export interface ResumeCompactionControl {
  readonly tokens: number;
  readonly keepFullHistory: boolean;
  readonly onToggleKeepFullHistory: () => void;
}

function formatTokens(tokens: number): string {
  return tokens < 999_500
    ? `${Math.round(tokens / 1_000)}k`
    : `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}

// The build-time translation pass keeps template values as they are, so the language is picked here.
function chipText(control: ResumeCompactionControl) {
  const tokens = formatTokens(control.tokens);
  if (useChinese) {
    return control.keepFullHistory
      ? {
          label: `保留 ${tokens}`,
          accessibilityLabel: `下次傳送會保留全部 ${tokens} 個 token。點一下改為先壓縮`,
        }
      : {
          label: `壓縮 ${tokens}`,
          accessibilityLabel: `下次傳送前會先壓縮 ${tokens} 個 token。點一下改為保留完整歷史`,
        };
  }
  return control.keepFullHistory
    ? {
        label: `Keep ${tokens}`,
        accessibilityLabel: `Next send keeps all ${tokens} tokens. Tap to compact first`,
      }
    : {
        label: `Compact ${tokens}`,
        accessibilityLabel: `Next send compacts ${tokens} tokens first. Tap to keep full history`,
      };
}

export function ResumeCompactionChip(props: {
  readonly control: ResumeCompactionControl;
  readonly disabled: boolean;
}) {
  const text = chipText(props.control);
  return (
    <View className="mb-1.5 flex-row justify-end">
      <Chip
        size="small"
        icon="arrow.down.right.and.arrow.up.left"
        label={text.label}
        accessibilityLabel={text.accessibilityLabel}
        selected={!props.control.keepFullHistory}
        disabled={props.disabled}
        onPress={props.control.onToggleKeepFullHistory}
      />
    </View>
  );
}
