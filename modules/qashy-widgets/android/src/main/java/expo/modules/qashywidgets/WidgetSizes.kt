package expo.modules.qashywidgets

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.res.Configuration
import android.os.Bundle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp

/**
 * The breakpoints of every widget kind, one per launcher cell count.
 *
 * Android's sizing guidance gives a widget that spans n cells about 73n - 16 dp of width (portrait
 * phone launchers), which is where the widths come from: 57, 130, 203, 276 and 349 dp for one to
 * five cells. Heights are 50, 130 and 203 dp for one to three rows (the rows are taller than they
 * are wide on most launchers, and the platform's own floor for one row is 40 dp).
 *
 * `SizeMode.Responsive` hands the system these sizes as candidate layouts and the system shows the
 * largest one that fits inside the widget's real size, so a layout is always at most as big as the
 * space it gets: a launcher whose cells are a little smaller than the guidance simply shows the
 * next smaller layout, never a clipped one. `LocalSize` is the chosen breakpoint, not the real
 * size, so a layout is designed for these numbers and gets any extra room from weights.
 *
 * Only these nine combinations exist (the others, such as 5x2 or 3x3, use the closest smaller one):
 * 1x1, 2x1, 3x1, 4x1, 5x1, 2x2, 3x2, 4x2 and 4x3.
 */
internal object WidgetSizes {
  val WIDTHS: List<Dp> = listOf(57.dp, 130.dp, 203.dp, 276.dp, 349.dp)
  val HEIGHTS: List<Dp> = listOf(50.dp, 130.dp, 203.dp)

  val BREAKPOINTS: Set<DpSize> = setOf(
    DpSize(WIDTHS[0], HEIGHTS[0]),
    DpSize(WIDTHS[1], HEIGHTS[0]),
    DpSize(WIDTHS[2], HEIGHTS[0]),
    DpSize(WIDTHS[3], HEIGHTS[0]),
    DpSize(WIDTHS[4], HEIGHTS[0]),
    DpSize(WIDTHS[1], HEIGHTS[1]),
    DpSize(WIDTHS[2], HEIGHTS[1]),
    DpSize(WIDTHS[3], HEIGHTS[1]),
    DpSize(WIDTHS[3], HEIGHTS[2]),
  )

  /**
   * The size text is fitted against: the smaller, per axis, of the layout's breakpoint and what
   * the launcher reports in the widget [options] (portrait: minimum width by maximum height;
   * landscape: maximum width by minimum height). The breakpoint is never larger than the real size
   * on a launcher that reports honestly, but some (and OEM grids with their own padding) hand out
   * more than they show, so the conservative one wins. It only narrows text decisions; the layout
   * itself still comes from the breakpoint.
   */
  fun fitSize(context: Context, layout: DpSize, options: Bundle?): DpSize {
    if (options == null) return layout
    val landscape = context.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
    val reportedW = options.getInt(if (landscape) AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH else AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0)
    val reportedH = options.getInt(if (landscape) AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT else AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0)
    return DpSize(
      if (reportedW > 0) minOf(layout.width, reportedW.dp) else layout.width,
      if (reportedH > 0) minOf(layout.height, reportedH.dp) else layout.height,
    )
  }

  /** The number of cells wide (1 to 5) a chosen breakpoint stands for. */
  fun cols(size: DpSize): Int = count(WIDTHS, size.width)

  /** The number of cells high (1 to 3) a chosen breakpoint stands for. */
  fun rows(size: DpSize): Int = count(HEIGHTS, size.height)

  // A dp of slack absorbs the float rounding of a size that went through pixels and back.
  private fun count(steps: List<Dp>, value: Dp): Int =
    (steps.indexOfLast { value + 1.dp >= it } + 1).coerceAtLeast(1)
}
