import type { ReactNode } from "react";

import { AnimationLevelContext } from "@/components/ui/animation-level-context";
import { useFinanceSettings } from "@/providers/finance-provider";

/** Publishes the device's `animationLevel` setting to the motion system. Mount inside the finance provider. */
export function AnimationLevelProvider({ children }: { children: ReactNode }) {
  const settings = useFinanceSettings();
  return (
    <AnimationLevelContext value={settings.animationLevel ?? "all"}>
      {children}
    </AnimationLevelContext>
  );
}
