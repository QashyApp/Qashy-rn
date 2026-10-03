import type { ReactNode } from "react";

/** iOS and web have a single navigation bar, so there is no sheet and no provider state. */
export function NavBarStyleSheetProvider({
  children,
}: {
  children: ReactNode;
}) {
  return <>{children}</>;
}
