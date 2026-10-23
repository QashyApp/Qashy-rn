import type { RecurrenceUnit } from "@/domain/models";

export const MAX_REPEAT_INTERVAL = 999;

/** "Every month." / "Every 2 months." — plain English singular/plural; Hermes (Android) has no `Intl.PluralRules`. */
export function intervalHint(interval: string, unit: RecurrenceUnit) {
  const count = Number(interval);
  if (!Number.isInteger(count) || count < 1) return `Every ${unit}.`;
  return count === 1 ? `Every ${unit}.` : `Every ${count} ${unit}s.`;
}

export type EndMode = "never" | "date" | "count";

export const END_MODES: { value: EndMode; label: string; icon: string }[] = [
  { value: "never", label: "Never", icon: "ion:infinite-outline" },
  { value: "date", label: "On a date", icon: "calendar" },
  { value: "count", label: "After a number of times", icon: "repeat" },
];
