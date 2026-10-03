/** The four primary sections, in tab order. Route names match the folders under `src/app/(tabs)/`. */
export const TAB_SECTIONS = [
  "overview",
  "transactions",
  "plan",
  "more",
] as const;
export type TabSection = (typeof TAB_SECTIONS)[number];

/** SF-symbol style ids drawn by `AppIcon`, shared with the web navigation so a section reads the same everywhere. */
export const TAB_SECTION_ICONS: Record<TabSection, string> = {
  overview: "house",
  transactions: "list.bullet.rectangle",
  plan: "chart.pie",
  more: "ellipsis.circle",
};

/**
 * The section a pathname belongs to (`/transactions/x` -> `transactions`), or null for anything outside
 * the tabs (a form sheet, /appearance). Used to put the user back on their section after the navigator
 * is swapped for the other bar style.
 */
export function sectionOfPathname(pathname: string): TabSection | null {
  const first = pathname.split("/").filter(Boolean)[0];
  if (first === undefined) return null;
  return (TAB_SECTIONS as readonly string[]).includes(first)
    ? (first as TabSection)
    : null;
}
