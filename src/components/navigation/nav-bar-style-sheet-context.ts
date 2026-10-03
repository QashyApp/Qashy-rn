import { createContext, use } from "react";

export interface NavBarStyleSheetControls {
  /** True where the bar style can be chosen (Android only). */
  available: boolean;
  open: () => void;
}

export const NavBarStyleSheetContext = createContext<NavBarStyleSheetControls>({
  available: false,
  open: () => undefined,
});

/** Opens the "Navigation bar style" bottom sheet. A no-op where there is nothing to choose. */
export function useNavBarStyleSheet(): NavBarStyleSheetControls {
  return use(NavBarStyleSheetContext);
}
