import { useId, useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { WorkLogBlock } from "./work-log-layout";

const FADE_HEIGHT = 24;

/** A capped thought box; a clipped thought fades out so the next reply does not read as part of it. */
export function ReasoningGroupScroll(props: {
  readonly continues: boolean | undefined;
  readonly fadeColor: string;
  readonly children: ReactNode;
}) {
  const [viewportHeight, setViewportHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const [atEnd, setAtEnd] = useState(false);
  const clipped = contentHeight > viewportHeight + 1;
  return (
    <WorkLogBlock continues={props.continues}>
      <View className="ml-7">
        <ScrollView
          nestedScrollEnabled
          className="max-h-96 py-1"
          scrollEventThrottle={64}
          onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
          onContentSizeChange={(_, height) => setContentHeight(height)}
          onScroll={({ nativeEvent }) =>
            setAtEnd(
              nativeEvent.contentOffset.y + nativeEvent.layoutMeasurement.height >=
                nativeEvent.contentSize.height - 1,
            )
          }
        >
          {props.children}
        </ScrollView>
        {clipped && !atEnd ? <BottomFade color={props.fadeColor} /> : null}
      </View>
    </WorkLogBlock>
  );
}

function BottomFade(props: { readonly color: string }) {
  const gradientId = `reasoning-fade-${useId().replaceAll(":", "")}`;
  return (
    <View
      pointerEvents="none"
      className="absolute inset-x-0 bottom-0"
      style={{ height: FADE_HEIGHT }}
    >
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={gradientId} x1="0%" x2="0%" y1="0%" y2="100%">
            <Stop offset={0} stopColor={props.color} stopOpacity={0} />
            <Stop offset={1} stopColor={props.color} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${gradientId})`} />
      </Svg>
    </View>
  );
}
