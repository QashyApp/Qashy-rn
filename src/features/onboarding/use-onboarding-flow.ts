import { router } from "expo-router";
import { useRef, useState } from "react";

import {
  defaultAccountName,
  initialLocalePreferences,
  QASHY_ACCENT,
} from "@/domain/defaults";
import type { AccountType, AccentSource, ThemeMode } from "@/domain/models";
import type { OnboardingInput } from "@/data/repository";
import { languageFromLocale } from "@/localization/localization";
import {
  useFinanceRepository,
  useFinanceState,
} from "@/providers/finance-provider";
import { errorMessage, showError } from "@/utils/confirm";
import {
  validateCurrencyCode,
  validateLocale,
  validateMoneyInput,
} from "@/utils/form-validation";
import { hapticSuccess } from "@/utils/haptics";
import { parseMoney } from "@/utils/money";

/**
 * The setup steps, in order. `welcome` and `existing` sit outside the numbered
 * progress: they decide *whether* to set up, not what to set up.
 */
export const SETUP_STEPS = ["currency", "account", "look", "ready"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];
export type OnboardingStep = "welcome" | "existing" | SetupStep;

export interface OnboardingDraft {
  locale: string;
  currency: string;
  accountName: string;
  accountType: AccountType;
  openingBalance: string;
  themeId: string;
  themeMode: ThemeMode;
  accentSource: AccentSource;
  accentHex: string;
}

/** Field errors for a draft. Pure, so the rules are testable without rendering. */
export function validateDraft(draft: OnboardingDraft) {
  const locale = validateLocale(draft.locale);
  const currency = validateCurrencyCode(draft.currency);
  const openingBalance =
    !locale && !currency
      ? validateMoneyInput(draft.openingBalance, draft.currency, draft.locale, {
          label: "Opening balance",
          optional: true,
        })
      : undefined;
  const accountName = draft.accountName.trim()
    ? undefined
    : "Give this account a name.";
  return { locale, currency, openingBalance, accountName };
}

/** Whether Continue is allowed on `step`. Every earlier step's rules still apply. */
export function stepIsValid(step: OnboardingStep, draft: OnboardingDraft) {
  const errors = validateDraft(draft);
  switch (step) {
    case "currency":
      return !errors.locale && !errors.currency;
    case "account":
    case "look":
    case "ready":
      return (
        !errors.locale &&
        !errors.currency &&
        !errors.openingBalance &&
        !errors.accountName
      );
    default:
      return true;
  }
}

/** The exact payload `completeOnboarding` receives. Throws on an invalid draft. */
export function finishPayload(draft: OnboardingDraft): OnboardingInput {
  if (!stepIsValid("ready", draft)) throw new Error("Setup is incomplete.");
  return {
    locale: draft.locale,
    baseCurrency: draft.currency.toUpperCase(),
    accountName: draft.accountName.trim(),
    accountType: draft.accountType,
    // Empty means "start from zero" rather than an error: most people set up
    // before they know the exact figure, and a balance is editable later.
    openingBalanceMinor: draft.openingBalance.trim()
      ? parseMoney(draft.openingBalance, draft.currency, draft.locale)
      : 0,
    themeId: draft.themeId,
    themeMode: draft.themeMode,
    accentSource: draft.accentSource,
    accentHex: draft.accentHex,
  };
}

export function useOnboardingFlow() {
  const repository = useFinanceRepository();
  const { settings } = useFinanceState();
  const [start] = useState(() => initialLocalePreferences(settings));
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<OnboardingDraft>(() => {
    const locale =
      languageFromLocale(start.locale) === "he" ? "he-IL" : "en-US";
    return {
      locale,
      currency: start.baseCurrency,
      accountName: defaultAccountName(locale),
      accountType: "checking",
      openingBalance: "",
      themeId: settings.themeId,
      themeMode: settings.themeMode,
      accentSource: settings.accentSource,
      accentHex: settings.accentHex || QASHY_ACCENT,
    };
  });

  // Language, theme and accent are previewed live by writing them to settings
  // as they change, so the rest of setup is already in the chosen language and
  // colors. Writes are chained so they land in the order they were made. The
  // base currency is deliberately *not* written here — it is create-only and
  // must arrive with `completeOnboarding` (see `local-finance-repository.ts`).
  const pendingSettingsWrite = useRef<Promise<void>>(Promise.resolve());
  const previewSetting = (
    patch: Parameters<typeof repository.updateSettings>[0],
  ) => {
    pendingSettingsWrite.current = pendingSettingsWrite.current
      .then(() => repository.updateSettings(patch))
      .then(() => undefined)
      .catch((reason) => {
        showError(
          "Couldn’t apply this setting",
          errorMessage(reason, "Try again."),
        );
      });
  };

  const update = (patch: Partial<OnboardingDraft>) =>
    setDraft((current) => {
      const next = { ...current, ...patch };
      // Keep the suggested account name in the chosen language, unless the user
      // has already typed their own.
      if (
        patch.locale &&
        current.accountName === defaultAccountName(current.locale)
      ) {
        next.accountName = defaultAccountName(patch.locale);
      }
      return next;
    });

  const setLocale = (locale: string) => {
    update({ locale });
    previewSetting({ locale });
  };
  const setTheme = (themeId: string) => {
    update({ themeId });
    previewSetting({ themeId });
  };
  const setThemeMode = (themeMode: ThemeMode) => {
    update({ themeMode });
    previewSetting({ themeMode });
  };
  const setAccent = (
    accentSource: AccentSource,
    accentHex = draft.accentHex,
  ) => {
    update({ accentSource, accentHex });
    previewSetting({ accentSource, accentHex });
  };

  const goTo = (next: OnboardingStep) => {
    const order: OnboardingStep[] = ["welcome", "existing", ...SETUP_STEPS];
    // `existing` branches off `welcome`; it is "forward" from there and
    // "back" to it, never compared against the setup steps.
    const forward =
      next === "existing" || order.indexOf(next) > order.indexOf(step);
    setDirection(forward ? "forward" : "back");
    setStep(next);
  };

  const setupIndex = SETUP_STEPS.indexOf(step as SetupStep);
  const next = () => {
    if (step === "welcome") return goTo("currency");
    if (
      setupIndex >= 0 &&
      setupIndex < SETUP_STEPS.length - 1 &&
      stepIsValid(step, draft)
    ) {
      goTo(SETUP_STEPS[setupIndex + 1]);
    }
  };
  const back = () => {
    if (step === "existing" || step === "currency") return goTo("welcome");
    if (setupIndex > 0) goTo(SETUP_STEPS[setupIndex - 1]);
  };

  const finish = async () => {
    if (saving || !stepIsValid("ready", draft)) return;
    setSaving(true);
    try {
      await pendingSettingsWrite.current;
      await repository.completeOnboarding(finishPayload(draft));
      hapticSuccess();
      if (
        process.env.EXPO_OS === "web" &&
        typeof navigator !== "undefined" &&
        navigator.storage?.persist
      ) {
        navigator.storage.persist().catch(() => false);
      }
      router.replace("/overview");
    } catch (reason) {
      showError(
        "Couldn’t finish setup",
        errorMessage(reason, "Check the form and try again."),
      );
    } finally {
      setSaving(false);
    }
  };

  return {
    step,
    direction,
    draft,
    errors: validateDraft(draft),
    valid: stepIsValid(step, draft),
    saving,
    /** 1-based position among the numbered setup steps, or 0 outside them. */
    progress: setupIndex + 1,
    update,
    setLocale,
    setTheme,
    setThemeMode,
    setAccent,
    goTo,
    next,
    back,
    finish,
  };
}

export type OnboardingFlow = ReturnType<typeof useOnboardingFlow>;
