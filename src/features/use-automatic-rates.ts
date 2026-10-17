/**
 * Shared exchange-rate behavior for the forms: the debounced fire-and-forget lookup and the
 * "Turn on automatic rates" action.
 */

import { useEffect, useState } from "react";

import type { RatePair } from "@/data/exchange-rates/rate-service";
import { useExchangeRateService } from "@/providers/exchange-rate-provider";
import { useFinanceRepository } from "@/providers/finance-provider";
import { errorMessage, showError } from "@/utils/confirm";

const RATE_LOOKUP_DEBOUNCE_MS = 400;

/**
 * Debounced: once `pairs` settles, looks up the rates it needs so the applied rate fills in on the
 * spot. Fire-and-forget — a failure only ever shows up as "No rate for this date.", never as a
 * save error. `pairs` must be memoized. Returns whether a lookup is in flight.
 */
export function useRateLookup(pairs: readonly RatePair[]): boolean {
  const exchangeRateService = useExchangeRateService();
  const [fetching, setFetching] = useState(false);
  useEffect(() => {
    if (!pairs.length) return;
    const timer = setTimeout(() => {
      setFetching(true);
      exchangeRateService
        .ensureRatesFor(pairs)
        .catch(() => undefined)
        .finally(() => setFetching(false));
    }, RATE_LOOKUP_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [pairs, exchangeRateService]);
  return fetching;
}

/** Turns automatic rates on, then retries whatever recurring generation skipped for lack of one. */
export function useTurnOnAutomaticRates(afterEnable?: () => Promise<void>) {
  const exchangeRateService = useExchangeRateService();
  const repository = useFinanceRepository();
  const [turningOn, setTurningOn] = useState(false);
  const turnOn = async () => {
    if (turningOn) return;
    setTurningOn(true);
    try {
      await exchangeRateService.setEnabled(true);
      // Idempotent via occurrence keys: retries whatever rule generation skipped for lack of a
      // rate, now that this may have just supplied one.
      await repository.generateRecurring();
      await afterEnable?.();
    } catch (reason) {
      showError(
        "Couldn’t turn on automatic rates",
        errorMessage(reason, "Try again."),
      );
    } finally {
      setTurningOn(false);
    }
  };
  return { turningOn, turnOn };
}
