import { useState, type ReactNode } from "react";
import { View, type ColorValue } from "react-native";

import { AnimatedMoney } from "@/components/finance/animated-money";
import { StatTile } from "@/components/finance/stat-tile";
import { AppText } from "@/components/ui/app-text";
import type { CurrencyCode } from "@/domain/models";
import { materialStyle } from "@/theme/materials";
import { useQashyTheme } from "@/theme/theme";
import {
  MIN_CUT_LABEL,
  planCompactRow,
  type PillNeeds,
} from "@/features/transactions/compact-row-plan";
import { formatMoney } from "@/utils/money";

export interface SummaryTileData {
  label: string;
  amountMinor: number;
  color: ColorValue;
}

/** The compact tile's minimum height: one line of figure between the tile's own padding. */
const COMPACT_HEIGHT = 36;
/** A pill's label is drawn at this share of its size when the row is too narrow for full-size ones. */
const SMALL_LABEL = 0.85;
/** Room kept beyond each pill's measured content, against text that measures a hair short. */
const SLACK = 2;
/** Wide enough that a sizer never wraps. */
const SIZER_WIDTH = 2000;

/**
 * The month's Income / Spent / Net tiles. `compact` is the phone form: label beside figure on one
 * line, with the figure always in its short form. Otherwise each tile stacks its label above the
 * figure.
 */
export function SummaryTiles({
  tiles,
  currency,
  locale,
  compact,
}: {
  tiles: readonly SummaryTileData[];
  currency: CurrencyCode;
  locale: string;
  compact: boolean;
}) {
  const { space } = useQashyTheme();
  if (compact)
    return <CompactRow tiles={tiles} currency={currency} locale={locale} />;
  return (
    <View style={{ flexDirection: "row", gap: space.sm }}>
      {tiles.map((tile) => (
        <View key={tile.label} style={{ flex: 1, minWidth: 0 }}>
          <FullTile tile={tile} currency={currency} locale={locale} />
        </View>
      ))}
    </View>
  );
}

interface TileProps {
  tile: SummaryTileData;
  currency: CurrencyCode;
  locale: string;
}

function FullTile({ tile, currency, locale }: TileProps) {
  const theme = useQashyTheme();
  const { radius, space } = theme;
  return (
    <View
      style={{
        ...materialStyle(theme, "sunken"),
        borderRadius: radius.control,
        padding: space.md,
      }}
    >
      <StatTile
        label={tile.label}
        value={
          <AnimatedMoney
            minor={tile.amountMinor}
            currency={currency}
            locale={locale}
            variant="label"
            numeric
            style={{ color: tile.color }}
          />
        }
      />
    </View>
  );
}

/**
 * The compact pills sized by what they hold: each takes the width its own label and figure need,
 * and what is left over is shared out in proportion to that, so a "$0.00" pill gives room to a
 * "$912.00" one. Only when even that does not fit the row does the label step down in size, the
 * figures staying as they are, then get ellipsized; and when the figures alone cannot sit side by
 * side the pills stack their label over their figure. A figure is never cut.
 */
function CompactRow({
  tiles,
  currency,
  locale,
}: {
  tiles: readonly SummaryTileData[];
  currency: CurrencyCode;
  locale: string;
}) {
  const { space, type } = useQashyTheme();
  const [rowWidth, setRowWidth] = useState(0);
  const [needs, setNeeds] = useState<Record<string, Partial<PillNeeds>>>({});
  const measure = (key: string, field: keyof PillNeeds) => (width: number) =>
    setNeeds((current) =>
      current[key]?.[field] === width
        ? current
        : { ...current, [key]: { ...current[key], [field]: width } },
    );

  const chrome = space.md * 2 + space.xs + SLACK;
  const measured = tiles.map((tile) => ({ tile, ...needs[tile.label] }));
  const complete = measured.every(isComplete);
  const known = rowWidth > 0 && complete;
  const form = known
    ? planCompactRow(measured as PillNeeds[], rowWidth, chrome, space.sm)
    : "full";
  const labelSize = Math.round(type.scale.caption.fontSize * SMALL_LABEL);

  return (
    <View>
      {/* Every label and figure at its natural size, off to the side, to size the pills by. */}
      <View
        pointerEvents="none"
        aria-hidden
        importantForAccessibility="no-hide-descendants"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 0,
          overflow: "hidden",
        }}
      >
        <View style={{ width: SIZER_WIDTH, opacity: 0 }}>
          {tiles.map((tile) => (
            <View key={tile.label} style={{ alignSelf: "flex-start" }}>
              <Measured onWidth={measure(tile.label, "label")}>
                <AppText variant="caption" muted>
                  {tile.label}
                </AppText>
              </Measured>
              <Measured onWidth={measure(tile.label, "smallLabel")}>
                <AppText
                  variant="caption"
                  muted
                  style={{ fontSize: labelSize }}
                >
                  {tile.label}
                </AppText>
              </Measured>
              <Measured onWidth={measure(tile.label, "amount")}>
                <AppText literal variant="label" numeric figure>
                  {formatMoney(tile.amountMinor, currency, locale, {
                    compact: true,
                  })}
                </AppText>
              </Measured>
            </View>
          ))}
        </View>
      </View>
      <View
        onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)}
        // Laid out but unseen until the sizes are known, so no frame shows equal pills first.
        style={{
          flexDirection: "row",
          gap: space.sm,
          opacity: known ? 1 : 0,
        }}
      >
        {measured.map(({ tile, label, smallLabel, amount }) => {
          const need = (form === "full" ? label : smallLabel) ?? 0;
          return (
            <View
              key={tile.label}
              style={
                form === "stacked"
                  ? { flex: 1, minWidth: 0 }
                  : {
                      // The pill's own size, and a share of what is left in proportion to it.
                      flexBasis: "auto",
                      flexGrow: Math.max(1, chrome + need + (amount ?? 0)),
                      flexShrink: 1,
                      // Whatever the row has to give up, a figure keeps its room.
                      minWidth:
                        amount === undefined
                          ? 0
                          : chrome +
                            amount +
                            (form === "cut"
                              ? Math.min(smallLabel ?? 0, MIN_CUT_LABEL)
                              : 0),
                    }
              }
            >
              <CompactTile
                tile={tile}
                currency={currency}
                locale={locale}
                labelSize={form === "full" ? undefined : labelSize}
                cutLabel={form === "cut"}
                stacked={form === "stacked"}
              />
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** Whether every size of one pill has been measured. */
function isComplete(item: Partial<PillNeeds>): item is PillNeeds {
  return (
    item.label !== undefined &&
    item.smallLabel !== undefined &&
    item.amount !== undefined
  );
}

/** Reports the width its content takes when nothing constrains it. */
function Measured({
  onWidth,
  children,
}: {
  onWidth: (width: number) => void;
  children: ReactNode;
}) {
  return (
    <View
      style={{ alignSelf: "flex-start" }}
      onLayout={(event) => onWidth(Math.ceil(event.nativeEvent.layout.width))}
    >
      {children}
    </View>
  );
}

function CompactTile({
  tile,
  currency,
  locale,
  labelSize,
  cutLabel,
  stacked,
}: TileProps & { labelSize?: number; cutLabel: boolean; stacked: boolean }) {
  const theme = useQashyTheme();
  const { radius, space } = theme;
  return (
    <View
      style={{
        ...materialStyle(theme, "sunken"),
        borderRadius: radius.control,
        minHeight: COMPACT_HEIGHT,
        ...(stacked
          ? {
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: space.xs,
              paddingVertical: space.xs,
            }
          : {
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: space.xs,
              paddingHorizontal: space.md,
            }),
      }}
    >
      <AppText
        variant="caption"
        muted
        numberOfLines={cutLabel || stacked ? 1 : undefined}
        style={[
          // The label gives way before the figure does, and only in the last steps.
          cutLabel ? { flexShrink: 1 } : { flexShrink: 0 },
          labelSize ? { fontSize: labelSize } : null,
        ]}
      >
        {tile.label}
      </AppText>
      <AnimatedMoney
        minor={tile.amountMinor}
        currency={currency}
        locale={locale}
        compact
        variant="label"
        numeric
        style={{ color: tile.color, flexShrink: 0 }}
      />
    </View>
  );
}
