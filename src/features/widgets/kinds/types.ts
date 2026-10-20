import type { WidgetAppearance } from "@/features/widgets/settings";
import type {
  SnapshotInput,
  WidgetSnapshotEntry,
} from "@/features/widgets/snapshot";

/** What a kind adds to its snapshot entry besides `kind` and `style`. */
export type WidgetKindPayload = Omit<WidgetSnapshotEntry, "kind" | "style">;

/** The fields a config has beyond `kind` and the appearance every kind shares. */
export type KindFields<C> = Omit<C, "kind" | keyof WidgetAppearance>;

/**
 * Everything the data side needs to know about one widget kind. A kind is one file that exports
 * one of these, plus one line in `kinds/index.ts`; settings validation and the snapshot builder
 * read it from there and never name a kind themselves.
 */
export interface WidgetKindDefinition<
  C extends WidgetAppearance & { kind: string },
> {
  readonly kind: C["kind"];
  /** The kind's own fields for a widget with no stored config. */
  readonly defaults: KindFields<C>;
  /** The kind's own fields from untrusted input; an invalid field falls back to its default. */
  normalize(raw: Record<string, unknown>): KindFields<C>;
  /** The kind's part of the snapshot entry; everything in it is already formatted for display. */
  build(
    config: C,
    input: SnapshotInput,
    hideAmounts: boolean,
  ): WidgetKindPayload;
}
