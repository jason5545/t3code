import { requireNativeModule } from "expo";
import { useEffect } from "react";

const nativeControls = () =>
  requireNativeModule<{ setSecureWindow(secure: boolean): void }>("T3NativeControls");

// Split layouts can show two composers at once; the window stays secure until both let go.
let secureHolders = 0;

/** Fork patch 11: FLAG_SECURE while an ephemeral thread is on screen. */
export function SecureWindow(props: { readonly active: boolean }) {
  const { active } = props;
  useEffect(() => {
    if (!active) return;
    secureHolders += 1;
    if (secureHolders === 1) nativeControls().setSecureWindow(true);
    return () => {
      secureHolders -= 1;
      if (secureHolders === 0) nativeControls().setSecureWindow(false);
    };
  }, [active]);
  return null;
}
