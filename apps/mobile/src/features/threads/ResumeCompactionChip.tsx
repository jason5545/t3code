import { View } from "react-native";

import { Chip } from "../../components/ui/Chip";

/** Web's "When you return" compaction toggle, for the next mobile send. */
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

function chipText(control: ResumeCompactionControl) {
  const tokens = formatTokens(control.tokens);
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
