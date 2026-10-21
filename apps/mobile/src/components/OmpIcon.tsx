import { Defs, LinearGradient, Path, Stop, Svg } from "react-native-svg";

/** OMP's π mark and gradient, as published at omp.sh. */
export function OmpIcon(props: { readonly size: number }) {
  return (
    <Svg width={props.size} height={props.size} viewBox="10 13 44 44" fill="none">
      <Defs>
        <LinearGradient id="omp-mark" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#ed4abf" />
          <Stop offset=".5" stopColor="#9b4dff" />
          <Stop offset="1" stopColor="#5ad8e6" />
        </LinearGradient>
      </Defs>
      <Path fill="url(#omp-mark)" d="M10 14h44v9H43v33h-9V23h-9v22h-9V23H10z" />
    </Svg>
  );
}
