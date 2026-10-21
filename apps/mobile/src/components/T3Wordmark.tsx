import type { ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";
import { withUniwind } from "uniwind";

const ThemedPath = withUniwind(Path);

export function T3Wordmark(props: {
  readonly height: number;
  readonly color?: ColorValue;
  readonly colorClassName?: string;
}) {
  const aspectRatio = 94.3941 / 56.96;
  return (
    <Svg
      accessibilityLabel="T3"
      height={props.height}
      width={props.height * aspectRatio}
      viewBox="15.5309 37 94.3941 56.96"
    >
      {/* Fork: T3 is the dot matrix from assets/nightly/app-icon.icon/Assets/text.svg; keep them in sync. */}
      <ThemedPath
        d="M15.531 46.173a5.244 5.244 0 1 0 10.488 0a5.244 5.244 0 1 0 -10.488 0ZM31.263 46.173a5.244 5.244 0 1 0 10.488 0a5.244 5.244 0 1 0 -10.488 0ZM46.996 46.173a5.244 5.244 0 1 0 10.488 0a5.244 5.244 0 1 0 -10.488 0ZM67.972 46.173a5.244 5.244 0 1 0 10.488 0a5.244 5.244 0 1 0 -10.488 0ZM83.704 46.173a5.244 5.244 0 1 0 10.488 0a5.244 5.244 0 1 0 -10.488 0ZM99.437 46.173a5.244 5.244 0 1 0 10.488 0a5.244 5.244 0 1 0 -10.488 0ZM31.263 65a5.244 5.244 0 1 0 10.488 0a5.244 5.244 0 1 0 -10.488 0ZM83.704 65a5.244 5.244 0 1 0 10.488 0a5.244 5.244 0 1 0 -10.488 0ZM99.437 65a5.244 5.244 0 1 0 10.488 0a5.244 5.244 0 1 0 -10.488 0ZM31.263 83.827a5.244 5.244 0 1 0 10.488 0a5.244 5.244 0 1 0 -10.488 0ZM67.972 83.827a5.244 5.244 0 1 0 10.488 0a5.244 5.244 0 1 0 -10.488 0ZM83.704 83.827a5.244 5.244 0 1 0 10.488 0a5.244 5.244 0 1 0 -10.488 0ZM99.437 83.827a5.244 5.244 0 1 0 10.488 0a5.244 5.244 0 1 0 -10.488 0Z"
        color={props.color}
        colorClassName={props.colorClassName}
        fill="currentColor"
      />
      <ThemedPath
        d="M15.531 65a5.244 5.244 0 1 0 10.488 0a5.244 5.244 0 1 0 -10.488 0ZM46.996 65a5.244 5.244 0 1 0 10.488 0a5.244 5.244 0 1 0 -10.488 0ZM67.972 65a5.244 5.244 0 1 0 10.488 0a5.244 5.244 0 1 0 -10.488 0ZM15.531 83.827a5.244 5.244 0 1 0 10.488 0a5.244 5.244 0 1 0 -10.488 0ZM46.996 83.827a5.244 5.244 0 1 0 10.488 0a5.244 5.244 0 1 0 -10.488 0Z"
        color={props.color}
        colorClassName={props.colorClassName}
        fill="currentColor"
        fillOpacity={0.4}
      />
    </Svg>
  );
}
