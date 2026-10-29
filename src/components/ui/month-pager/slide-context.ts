import { createContext, useContext } from "react";
import type { SharedValue } from "react-native-reanimated";

import type { MonthSlideStyle } from "@/domain/models";
import type { FollowSpec } from "@/components/ui/month-pager/slide-style";

/**
 * The part of a page that its `MonthSlideItem`s follow: the page's continuous offset on screen, and
 * a clock that ticks once per frame for as long as anything may still be moving. Every page has one,
 * so a page keeps the same shape whatever the style; only in the cascade style does the clock run and
 * do items follow.
 */
export interface PageCascade {
  /** Where the page is on screen, in px from its resting slot (slot offset plus the drag). */
  offset: SharedValue<number>;
  /** Changes every frame while `running`; the value itself means nothing. */
  clock: SharedValue<number>;
  /** The clock is ticking. Once it stops, every follower sits exactly in its page. */
  running: SharedValue<boolean>;
  /** The top item's follow spring, from the theme. */
  base: FollowSpec;
  /** How far an item may trail its page, in px. */
  lag: number;
}

export interface PageSlide {
  /** The style this page plays; `calm` whenever content may not travel. Items follow in `cascade` only. */
  style: MonthSlideStyle;
  cascade: PageCascade;
}

/** Set by a pager page; absent outside one, where a `MonthSlideItem` is a plain view. */
export const PageSlideContext = createContext<PageSlide | null>(null);

export function usePageSlide() {
  return useContext(PageSlideContext);
}
