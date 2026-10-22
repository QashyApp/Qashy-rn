import { useEffect } from "react";

import { useFinanceSettings } from "@/providers/finance-provider";
import { setHapticsEnabled } from "@/utils/haptics";

/** Applies the device's `hapticsEnabled` setting to the haptic helpers. Mount inside the finance provider. */
export function HapticsPreference() {
  const enabled = useFinanceSettings().hapticsEnabled ?? true;
  useEffect(() => {
    setHapticsEnabled(enabled);
  }, [enabled]);
  return null;
}
