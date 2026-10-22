import type { FinanceContext } from "@/data/finance/context";
import { ENTITY_TYPES } from "@/data/finance/records";
import {
  ACCENT_SOURCES,
  ACCOUNT_TYPES,
  assertSafeMinor,
  assertColor,
  assertExpectedRevision,
  assertLocale,
  normalizeCurrency,
  THEME_MODES,
} from "@/data/finance/validation";
import {
  ANIMATION_LEVELS,
  NAV_BAR_STYLES,
  type AppSettings,
  type FinanceEntity,
} from "@/domain/models";
import type { OnboardingInput, SettingsInput } from "@/data/repository";
import { createDefaultCategories, defaultAccountName } from "@/domain/defaults";
import { isValidThemeId } from "@/theme/themes/types";
import { createEntity, makeId, updateEntity } from "@/utils/entity";

/** The settings row `patch` turns `current` into; throws before anything is written if it is invalid. */
export function buildSettingsUpdate(
  current: AppSettings,
  patch: SettingsInput,
  expectedRevision?: number,
) {
  assertExpectedRevision(current, patch, expectedRevision);
  const locale = patch.locale ?? current.locale;
  const baseCurrency = normalizeCurrency(
    patch.baseCurrency ?? current.baseCurrency,
  );
  assertLocale(locale);
  assertColor(patch.accentHex ?? current.accentHex);
  const themeId = patch.themeId ?? current.themeId;
  if (!isValidThemeId(themeId)) throw new Error("Choose a valid theme.");
  const themeMode = patch.themeMode ?? current.themeMode;
  const accentSource = patch.accentSource ?? current.accentSource;
  if (!THEME_MODES.includes(themeMode))
    throw new Error("Choose a valid theme mode.");
  if (!ACCENT_SOURCES.includes(accentSource))
    throw new Error("Choose a valid accent source.");
  if (baseCurrency !== current.baseCurrency && current.onboardingComplete) {
    throw new Error("Base currency cannot change after setup is complete.");
  }
  const navBarStyle = patch.navBarStyle ?? current.navBarStyle ?? "native";
  if (!NAV_BAR_STYLES.includes(navBarStyle))
    throw new Error("Choose a valid navigation bar style.");
  const animationLevel =
    patch.animationLevel ?? current.animationLevel ?? "all";
  if (!ANIMATION_LEVELS.includes(animationLevel))
    throw new Error("Choose a valid animation level.");
  const override = (
    key:
      | "fontTextOverride"
      | "fontNumericOverride"
      | "uiIconSetOverride"
      | "categoryIconSetOverride",
  ): string | null => {
    // null clears, undefined keeps; an id nothing resolves is allowed and falls back at render time.
    const next = patch[key] === undefined ? (current[key] ?? null) : patch[key];
    if (next === null) return null;
    if (typeof next !== "string" || !/^[a-z0-9-]{1,48}$/.test(next))
      throw new Error("Choose a valid appearance override.");
    return next;
  };
  const overrides = {
    fontTextOverride: override("fontTextOverride"),
    fontNumericOverride: override("fontNumericOverride"),
    uiIconSetOverride: override("uiIconSetOverride"),
    categoryIconSetOverride: override("categoryIconSetOverride"),
  };
  const settings = updateEntity(current, {
    onboardingComplete: current.onboardingComplete,
    locale,
    baseCurrency,
    themeId,
    themeMode,
    accentSource,
    accentHex: (patch.accentHex ?? current.accentHex).toUpperCase(),
    swipeBetweenMonths:
      patch.swipeBetweenMonths ?? current.swipeBetweenMonths ?? false,
    navBarStyle,
    animationLevel,
    hapticsEnabled: patch.hapticsEnabled ?? current.hapticsEnabled ?? true,
    ...overrides,
  });
  return settings;
}

/** The settings, first account and starter categories that completing onboarding writes. */
export function planOnboarding(ctx: FinanceContext, input: OnboardingInput) {
  if (
    ctx.state.settings.onboardingComplete ||
    ENTITY_TYPES.some((type) => (ctx.state[type] as FinanceEntity[]).length > 0)
  )
    throw new Error("Qashy setup is already complete.");
  assertLocale(input.locale);
  const baseCurrency = normalizeCurrency(input.baseCurrency);
  assertSafeMinor(input.openingBalanceMinor, "Opening balance");
  assertColor(input.accentHex);
  if (!ACCOUNT_TYPES.includes(input.accountType))
    throw new Error("Choose a valid account type.");
  const themeId = input.themeId ?? ctx.state.settings.themeId;
  if (!isValidThemeId(themeId)) throw new Error("Choose a valid theme.");
  if (!THEME_MODES.includes(input.themeMode))
    throw new Error("Choose a valid theme mode.");
  if (!ACCENT_SOURCES.includes(input.accentSource))
    throw new Error("Choose a valid accent source.");
  const settings = updateEntity(ctx.state.settings, {
    onboardingComplete: true,
    baseCurrency,
    themeId,
    themeMode: input.themeMode,
    accentSource: input.accentSource,
    accentHex: input.accentHex.toUpperCase(),
  });
  const account = createEntity({
    id: makeId(),
    name: input.accountName.trim() || defaultAccountName(input.locale),
    type: input.accountType,
    currency: baseCurrency,
    openingBalanceMinor: input.openingBalanceMinor,
    icon: "wallet.bifold",
    color: input.accentHex.toUpperCase(),
    archived: false,
  });
  const categories = createDefaultCategories(input.locale);
  return { settings, account, categories };
}
