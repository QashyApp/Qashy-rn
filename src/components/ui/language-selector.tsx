import { SegmentedControl } from "@/components/ui/segmented-control";

/** Each language is shown in its own name so it is findable whatever the UI language is. */
const LANGUAGES = [
  { value: "en-US", label: "English", literal: true },
  { value: "he-IL", label: "עברית", literal: true },
] as const;

/**
 * The English/Hebrew choice, shared by the onboarding welcome step and
 * Appearance. Callers own persistence (both write `settings.locale`); RTL
 * follows from the locale in `LocalizationProvider`, so no reload is needed.
 * The control stays left-to-right so the two options never swap places when
 * the language flips the layout.
 */
export function LanguageSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (locale: string) => void;
}) {
  return (
    <SegmentedControl
      label="Language"
      options={LANGUAGES}
      value={value}
      onChange={onChange}
      lockLtr
    />
  );
}
