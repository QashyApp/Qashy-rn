import { useId, useState } from 'react';
import { View, type ColorValue, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { useQashyTheme } from '@/theme/theme';

/**
 * Builds a smoothed path through `points` using a simple quadratic-midpoint
 * smoothing: each segment curves toward the midpoint between two points
 * instead of joining them with a straight line, which is enough to read as a
 * trend rather than a jagged reading without the complexity of a full
 * monotone-cubic (Catmull-Rom) fit.
 */
function smoothPath(points: { x: number; y: number }[]) {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const midX = (previous.x + current.x) / 2;
    const midY = (previous.y + current.y) / 2;
    path += ` Q ${previous.x} ${previous.y} ${midX} ${midY}`;
  }
  const last = points[points.length - 1];
  path += ` L ${last.x} ${last.y}`;
  return path;
}

/**
 * A minimal trend line for a hero footer or a stat tile: no axes, no
 * gridlines, just the shape of a series with a soft area fill and a dot on
 * the last point. Chart meaning must never rely on color alone elsewhere in
 * the app — this component only ever illustrates a trend already stated in
 * words by its caller's `label` (and, typically, an adjacent figure), so it
 * carries no independent meaning of its own beyond that accessibility label.
 */
export function Sparkline({
  values,
  width,
  height = 36,
  color,
  label,
}: {
  values: number[];
  /** Falls back to measuring the parent via `onLayout` when omitted. */
  width?: number;
  height?: number;
  color?: ColorValue;
  label: string;
}) {
  const theme = useQashyTheme();
  const gradientId = useId();
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const resolvedColor = (color ?? theme.staticAccent) as string;
  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setMeasuredWidth((current) => (Math.abs(current - next) > 0.5 ? next : current));
  };
  const chartWidth = Math.max(width ?? measuredWidth, 1);
  const canDraw = values.length > 0 && chartWidth > 0;

  if (!canDraw) {
    return <View accessibilityRole="image" accessibilityLabel={label} onLayout={width ? undefined : onLayout} style={{ width, height }} />;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat series (one value, or every value equal) still needs a drawable
  // line rather than a division by zero, so it renders as a level line
  // through the middle instead of collapsing.
  const span = max - min || 1;
  const inset = 3;
  const plotWidth = Math.max(chartWidth - inset * 2, 1);
  const plotHeight = Math.max(height - inset * 2, 1);
  const points = values.map((value, index) => ({
    x: inset + (values.length > 1 ? (index / (values.length - 1)) * plotWidth : plotWidth / 2),
    y: inset + plotHeight - ((value - min) / span) * plotHeight,
  }));
  const path = smoothPath(points);
  const last = points[points.length - 1];
  const areaPath = `${path} L ${last.x} ${height} L ${points[0].x} ${height} Z`;

  return (
    <View accessibilityRole="image" accessibilityLabel={label} onLayout={width ? undefined : onLayout} style={{ width: width ?? '100%', height }}>
      {chartWidth > 1 ? (
        <Svg width="100%" height={height} viewBox={`0 0 ${chartWidth} ${height}`}>
          <Defs>
            <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={resolvedColor} stopOpacity={0.25} />
              <Stop offset="1" stopColor={resolvedColor} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
          <Path d={path} fill="none" stroke={resolvedColor} strokeWidth={theme.charts.sparklineWidth ?? theme.charts.lineWidth} strokeLinecap={theme.charts.lineCap} strokeLinejoin="round" />
          {values.length > 0 ? <Circle cx={last.x} cy={last.y} r={2.5} fill={resolvedColor} /> : null}
        </Svg>
      ) : null}
    </View>
  );
}
