import { Decimal } from "decimal.js";

import type { CurrencyCode } from "@/domain/models";

export const SUPPORTED_CURRENCY_CODES =
  "AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HRK HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SLL SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VES VND VUV WST XAF XCD XCG XDR XOF XPF XSU YER ZAR ZMW ZWG ZWL".split(
    " ",
  );

const SUPPORTED_CURRENCIES = new Set(SUPPORTED_CURRENCY_CODES);

const NUMBER_FORMATS = new Map<string, Intl.NumberFormat>();

/**
 * `Intl.NumberFormat` is expensive to construct (Hermes especially) and a list renders
 * several amounts per row, so formatters are built once per locale + options. A construction
 * that throws (bad locale or currency) is never cached, so callers see the same errors.
 */
function numberFormat(locale: string, options?: Intl.NumberFormatOptions) {
  const key = `${locale}|${options ? JSON.stringify(options) : ""}`;
  let format = NUMBER_FORMATS.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale, options);
    NUMBER_FORMATS.set(key, format);
  }
  return format;
}

const NUMBER_PARTS = new Map<string, ReturnType<typeof computeNumberParts>>();

function localeNumberParts(locale: string) {
  let parts = NUMBER_PARTS.get(locale);
  if (!parts) {
    parts = computeNumberParts(locale);
    NUMBER_PARTS.set(locale, parts);
  }
  return parts;
}

function computeNumberParts(locale: string) {
  const formatter = numberFormat(locale);
  const parts = formatter.formatToParts(-12345.6);
  const plusParts = numberFormat(locale, {
    signDisplay: "always",
  }).formatToParts(1);
  return {
    decimalSymbol: parts.find((part) => part.type === "decimal")?.value ?? ".",
    groupSymbol: parts.find((part) => part.type === "group")?.value ?? ",",
    minusSymbol: parts.find((part) => part.type === "minusSign")?.value ?? "-",
    plusSymbol:
      plusParts.find((part) => part.type === "plusSign")?.value ?? "+",
    digits: new Map(
      Array.from({ length: 10 }, (_, digit) => [
        numberFormat(locale, { useGrouping: false }).format(digit),
        String(digit),
      ]),
    ),
  };
}

function normalizeNumberInput(
  value: string,
  locale: string,
  currency?: CurrencyCode,
) {
  const { decimalSymbol, groupSymbol, minusSymbol, plusSymbol, digits } =
    localeNumberParts(locale);
  let normalized = value.trim();
  digits.forEach((ascii, localized) => {
    normalized = normalized.split(localized).join(ascii);
  });
  normalized = normalized
    .replace(/[\p{Sc}\s\u200E\u200F\u061C]/gu, "")
    .replace(currency ? new RegExp(currency, "gi") : /$^/, "");
  // A group symbol is only a thousands separator when it sits between digit
  // groups of three. Otherwise "12,50" in en-US would silently become 1250
  // instead of being rejected.
  if (groupSymbol.trim() && normalized.includes(groupSymbol)) {
    const integerPart = normalized
      .split(decimalSymbol)[0]
      .replace(/^[+\-\u2212]/, "");
    const groups = integerPart.split(groupSymbol);
    const wellFormed = groups.every(
      (group, index) =>
        /^\d+$/.test(group) &&
        (index === 0
          ? group.length <= 3
          : group.length === 3 ||
            (index < groups.length - 1 && group.length === 2)),
    );
    if (!wellFormed) throw new Error("Enter a valid number.");
  }
  normalized = normalized
    .split(groupSymbol)
    .join("")
    .split(decimalSymbol)
    .join(".")
    .split(minusSymbol)
    .join("-")
    .split(plusSymbol)
    .join("+");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) {
    throw new Error("Enter a valid number.");
  }
  return normalized;
}

function minorFromDecimal(
  decimal: Decimal,
  currency: CurrencyCode,
  locale: string,
) {
  const digits = currencyDigits(currency, locale);
  if (decimal.decimalPlaces() > digits) {
    throw new Error(`Amount can have at most ${digits} decimal places.`);
  }
  const minor = decimal.mul(new Decimal(10).pow(digits)).toNumber();
  if (!isSafeMinor(minor))
    throw new Error("Amount is outside the supported range.");
  return minor;
}

function localizeAsciiDigits(value: string, locale: string) {
  const formatter = numberFormat(locale, { useGrouping: false });
  return Array.from(value, (character) =>
    /\d/.test(character) ? formatter.format(Number(character)) : character,
  ).join("");
}

export function isSupportedCurrencyCode(value: string) {
  return SUPPORTED_CURRENCIES.has(value.trim().toUpperCase());
}

/**
 * Minor-unit digits for every supported currency, pinned.
 *
 * `Intl.NumberFormat` reads these from the runtime's ICU data, and Hermes on iOS, Hermes on
 * Android and each browser ship different CLDR versions. They disagree for a number of
 * codes (COP, HUF, IDR, IQD, PKR … moved between 0, 2 and 3 digits across releases), and
 * `amountMinor` is only meaningful relative to this number: two synced devices that disagree
 * would show the same stored integer as amounts a hundred times apart. The values below are
 * what CLDR 48 reports (ICU 78, the version the test environment runs); changing one
 * reinterprets every amount already stored in that currency, so do not edit them casually.
 */
const MINOR_DIGITS_BY_GROUP: Readonly<Record<number, string>> = {
  0: "AFN ALL BIF CLP COP DJF GNF HUF IDR IQD IRR ISK JPY KMF KPW KRW LAK LBP MGA MMK PKR PYG RWF SLL SOS SYP UGX VND VUV XAF XOF XPF YER",
  3: "BHD JOD KWD LYD OMR TND",
};

const MINOR_DIGITS = new Map<string, number>(
  Object.entries(MINOR_DIGITS_BY_GROUP).flatMap(([digits, codes]) =>
    codes.split(" ").map((code): [string, number] => [code, Number(digits)]),
  ),
);

export function currencyDigits(currency: CurrencyCode, locale = "en-US") {
  // Every other supported currency has two. Anything outside the supported list is not pinned
  // and still asks the runtime, so a caller probing an unknown code gets the same error as before.
  const code = currency.trim().toUpperCase();
  if (SUPPORTED_CURRENCIES.has(code)) return MINOR_DIGITS.get(code) ?? 2;
  try {
    return (
      numberFormat(locale, {
        style: "currency",
        currency,
      }).resolvedOptions().maximumFractionDigits ?? 2
    );
  } catch {
    throw new Error(`Unsupported currency or locale: ${currency} (${locale}).`);
  }
}

export function parseMoney(
  value: string,
  currency: CurrencyCode,
  locale = "en-US",
) {
  try {
    return minorFromDecimal(
      new Decimal(normalizeNumberInput(value, locale, currency)),
      currency,
      locale,
    );
  } catch (reason) {
    // Preserve anything that already explains itself. Collapsing every failure to
    // "Enter a valid amount." also swallowed `Unsupported currency or locale: …`
    // from `currencyDigits`, which points at a configuration problem the user
    // cannot fix by retyping the number.
    if (
      reason instanceof Error &&
      (reason.message.startsWith("Amount ") ||
        reason.message.startsWith("Unsupported currency or locale"))
    )
      throw reason;
    throw new Error("Enter a valid amount.");
  }
}

export function parseInvariantMoney(
  value: string,
  currency: CurrencyCode,
  locale = "en-US",
) {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) {
    throw new Error("Enter a valid amount.");
  }
  try {
    return minorFromDecimal(new Decimal(value.trim()), currency, locale);
  } catch (reason) {
    // Preserve anything that already explains itself. Collapsing every failure to
    // "Enter a valid amount." also swallowed `Unsupported currency or locale: …`
    // from `currencyDigits`, which points at a configuration problem the user
    // cannot fix by retyping the number.
    if (
      reason instanceof Error &&
      (reason.message.startsWith("Amount ") ||
        reason.message.startsWith("Unsupported currency or locale"))
    )
      throw reason;
    throw new Error("Enter a valid amount.");
  }
}

export function normalizeDecimalString(value: string, locale = "en-US") {
  try {
    const decimal = new Decimal(normalizeNumberInput(value, locale));
    if (!decimal.isFinite()) throw new Error();
    return decimal.toString();
  } catch {
    throw new Error("Enter a valid number.");
  }
}

export function localizeDecimalString(value: string, locale = "en-US") {
  const { decimalSymbol, minusSymbol } = localeNumberParts(locale);
  const fixed = new Decimal(value).toFixed();
  const negative = fixed.startsWith("-");
  const unsigned = negative ? fixed.slice(1) : fixed;
  const localized = localizeAsciiDigits(
    unsigned.replace(".", decimalSymbol),
    locale,
  );
  return negative ? `${minusSymbol}${localized}` : localized;
}

export function convertMinor(
  amountMinor: number,
  fromCurrency: CurrencyCode,
  toCurrency: CurrencyCode,
  rate: string,
  locale = "en-US",
) {
  if (fromCurrency === toCurrency) return amountMinor;
  if (!isSafeMinor(amountMinor))
    throw new Error("Amount is outside the supported range.");
  const decimalRate = new Decimal(rate);
  if (!decimalRate.isFinite() || decimalRate.lte(0)) {
    throw new Error("Exchange rate must be a positive number.");
  }
  const fromScale = new Decimal(10).pow(currencyDigits(fromCurrency, locale));
  const toScale = new Decimal(10).pow(currencyDigits(toCurrency, locale));
  const converted = new Decimal(amountMinor)
    .div(fromScale)
    .mul(decimalRate)
    .mul(toScale)
    .toDecimalPlaces(0)
    .toNumber();
  if (!isSafeMinor(converted))
    throw new Error("Converted amount is outside the supported range.");
  return converted;
}

type MoneyOptions = { compact?: boolean; sign?: boolean };

/**
 * The ordered `Intl.NumberFormatPart`-shaped pieces behind both `formatMoney`
 * and `formatMoneyParts`. Kept as one function so the two can never drift:
 * `formatMoney` joins every part's `value`, and `formatMoneyParts` classifies
 * the same list into named fields. Do not inline this logic into either
 * caller again — that was the previous shape, and it was how the two output
 * paths quietly diverged.
 */
function moneyPartsList(
  minor: number,
  currency: CurrencyCode,
  locale: string,
  options?: MoneyOptions,
): { type: string; value: string }[] {
  const digits = currencyDigits(currency, locale);
  if (!isSafeMinor(minor))
    throw new Error("Amount is outside the supported range.");
  // Compact notation only starts abbreviating at a thousand. Below that it would
  // render the exact same magnitude while silently dropping minor units
  // ($12.50 -> "$12.5", $0.00 -> "$0"), so fall through to the exact formatter.
  // Use Decimal comparison directly to avoid an intermediate double that could
  // lose integer precision near MAX_SAFE_INTEGER.
  const compact =
    options?.compact === true &&
    new Decimal(minor).abs().div(new Decimal(10).pow(digits)).gte(1000);
  if (!compact) {
    const fixed = minorToDecimalString(Math.abs(minor), currency, locale);
    const [integer, fraction = ""] = fixed.split(".");
    const numberParts = numberFormat(locale, {
      useGrouping: true,
      maximumFractionDigits: 0,
    }).formatToParts(Number(integer));
    const sample = minor < 0 ? -1 : minor > 0 ? 1 : 0;
    const pattern = numberFormat(locale, {
      style: "currency",
      currency,
      signDisplay: options?.sign ? "exceptZero" : "auto",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).formatToParts(sample);
    let insertedInteger = false;
    return pattern.map((part) => {
      if (part.type === "integer" || part.type === "group") {
        if (insertedInteger) return { type: part.type, value: "" };
        insertedInteger = true;
        return {
          type: "integer",
          value: numberParts
            .filter(
              (numberPart) =>
                numberPart.type === "integer" || numberPart.type === "group",
            )
            .map((numberPart) => numberPart.value)
            .join(""),
        };
      }
      if (part.type === "fraction")
        return {
          type: "fraction",
          value: localizeAsciiDigits(fraction, locale),
        };
      return { type: part.type, value: part.value };
    });
  }
  const value = new Decimal(minor).div(new Decimal(10).pow(digits)).toNumber();
  return numberFormat(locale, {
    style: "currency",
    currency,
    notation: "compact",
    signDisplay: options?.sign ? "exceptZero" : "auto",
    maximumFractionDigits: 1,
  }).formatToParts(value);
}

export function formatMoney(
  minor: number,
  currency: CurrencyCode,
  locale = "en-US",
  options?: MoneyOptions,
) {
  return moneyPartsList(minor, currency, locale, options)
    .map((part) => part.value)
    .join("");
}

export interface MoneyParts {
  sign: string;
  currency: string;
  integer: string;
  /** The decimal separator and the fractional digits, e.g. ".34" or ",34". Empty for zero-decimal currencies. */
  fraction: string;
  currencyPosition: "before" | "after";
  /** Anything (bidi marks, a leading currency-adjacent space) that renders before the sign/currency/number cluster. */
  literalBefore: string;
  /** Anything (a compact suffix, a currency-adjacent space) that renders after the number, before a trailing currency. */
  literalAfter: string;
}

/**
 * The same value `formatMoney` renders, split into typed pieces so a caller
 * can style the currency symbol and fractional digits differently from the
 * integer part (see `AnimatedMoney`'s `split` prop). Built from
 * `Intl.NumberFormat.formatToParts` on the identical configuration
 * `moneyPartsList` uses for `formatMoney`, so the two can never disagree.
 *
 * Concatenating the fields back together as
 * `literalBefore + sign + (currencyPosition === 'before' ? currency : '') + integer + fraction + literalAfter + (currencyPosition === 'after' ? currency : '')`
 * reproduces `formatMoney(...)` exactly — this is asserted for every locale
 * this function is tested against, including RTL (Hebrew) and zero-decimal
 * (JPY) currencies, where bidi marks and a trailing currency respectively
 * land in `literalBefore`/`literalAfter` rather than being dropped.
 */
export function formatMoneyParts(
  minor: number,
  currency: CurrencyCode,
  locale = "en-US",
  options?: MoneyOptions,
): MoneyParts {
  const parts = moneyPartsList(minor, currency, locale, options);
  let sign = "";
  let currencyValue = "";
  let integer = "";
  let fraction = "";
  let literalBefore = "";
  let literalAfter = "";
  let currencyPosition: "before" | "after" = "before";
  let numericStarted = false;
  for (const part of parts) {
    if (part.type === "integer" || part.type === "group") {
      integer += part.value;
      numericStarted = true;
    } else if (part.type === "decimal" || part.type === "fraction") {
      fraction += part.value;
      numericStarted = true;
    } else if (part.type === "minusSign" || part.type === "plusSign") {
      sign += part.value;
    } else if (part.type === "currency") {
      currencyValue += part.value;
      currencyPosition = numericStarted ? "after" : "before";
    } else if (!numericStarted) {
      literalBefore += part.value;
    } else {
      literalAfter += part.value;
    }
  }
  return {
    sign,
    currency: currencyValue,
    integer,
    fraction,
    currencyPosition,
    literalBefore,
    literalAfter,
  };
}

export function minorToDecimalString(
  minor: number,
  currency: CurrencyCode,
  locale = "en-US",
) {
  const digits = currencyDigits(currency, locale);
  return new Decimal(minor).div(new Decimal(10).pow(digits)).toFixed(digits);
}

export function minorToLocalizedDecimalString(
  minor: number,
  currency: CurrencyCode,
  locale = "en-US",
) {
  const { decimalSymbol, minusSymbol } = localeNumberParts(locale);
  const fixed = minorToDecimalString(minor, currency, locale);
  const negative = fixed.startsWith("-");
  const unsigned = negative ? fixed.slice(1) : fixed;
  const localized = localizeAsciiDigits(
    unsigned.replace(".", decimalSymbol),
    locale,
  );
  return negative ? `${minusSymbol}${localized}` : localized;
}

export function isSafeMinor(value: number) {
  return (
    Number.isSafeInteger(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER
  );
}

export function addMinor(first: number, second: number, label = "Amount") {
  if (!isSafeMinor(first) || !isSafeMinor(second)) {
    throw new Error(`${label} is outside the supported range.`);
  }
  const result = first + second;
  if (!isSafeMinor(result))
    throw new Error(`${label} is outside the supported range.`);
  return result;
}

export function subtractMinor(first: number, second: number, label = "Amount") {
  return addMinor(first, -second, label);
}

export function sumMinor(values: Iterable<number>, label = "Amount") {
  let total = 0;
  for (const value of values) total = addMinor(total, value, label);
  return total;
}
