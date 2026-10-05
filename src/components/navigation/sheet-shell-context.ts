import { createContext, use } from "react";

export interface SheetShell {
  /** Plays the exit animation. Resolves once the sheet is off screen; the caller then removes the route. */
  exit: () => Promise<void>;
  /** Tells the shell whether closing needs the screen's confirmation, so it does not animate away first. */
  setGuarded: (guarded: boolean) => void;
}

export const SheetShellContext = createContext<SheetShell | null>(null);

/** The Android sheet a screen is shown in, or null where the platform presents the sheet itself. */
export function useSheetShell() {
  return use(SheetShellContext);
}
