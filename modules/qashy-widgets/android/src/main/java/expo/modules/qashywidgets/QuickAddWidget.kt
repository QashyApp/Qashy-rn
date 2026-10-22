package expo.modules.qashywidgets

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.glance.ColorFilter
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.action.Action
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxHeight
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.semantics.contentDescription
import androidx.glance.semantics.semantics
import androidx.glance.text.Text
import androidx.glance.text.TextAlign
import androidx.glance.unit.ColorProvider
import org.json.JSONObject

const val KIND_QUICK_ADD = "quickAdd"

/** The add button's touch target; its drawn size is smaller in a one-row widget, which is 50dp tall. */
private val BUTTON_TOUCH = 48.dp
private val BUTTON_DRAWN = 48.dp
private val BUTTON_DRAWN_SHORT = 40.dp

private val EDGE = 12.dp
private val BUTTON_GAP = 6.dp
private val BLOCK_GAP = 8.dp

/**
 * A metric the user switched off is null; the amounts are already masked when amounts are hidden.
 * Every amount comes in a full and a compact form ("$12,480.00" and "$12.5K"): the layout shows
 * the full one where it fits.
 */
class QuickAddData(
  val monthLabel: String,
  val netWorth: String?,
  val spent: String?,
  val earned: String?,
  val netWorthCompact: String? = netWorth,
  val spentCompact: String? = spent,
  val earnedCompact: String? = earned,
  /** The metric to show when only one fits: "netWorth", "spent" or "earned"; null when none is on. */
  val primary: String? = null,
) {
  val hasMetrics: Boolean get() = netWorth != null || spent != null || earned != null
}

internal fun parseQuickAdd(entry: JSONObject): QuickAddData? =
  entry.optJSONObject("quickAdd")?.let { o ->
    QuickAddData(
      monthLabel = o.optString("monthLabel"),
      netWorth = o.optStringOrNull("netWorth"),
      spent = o.optStringOrNull("spent"),
      earned = o.optStringOrNull("earned"),
      netWorthCompact = o.optStringOrNull("netWorthCompact"),
      spentCompact = o.optStringOrNull("spentCompact"),
      earnedCompact = o.optStringOrNull("earnedCompact"),
      primary = o.optStringOrNull("primary"),
    )
  }

private class Metric(val label: String, val full: String, val compact: String, val tone: ColorProvider)

/** The enabled metrics in display order; the primary one first, then the ones after it, wrapping. */
private fun orderedMetrics(q: QuickAddData, labels: Labels, colors: WidgetColors): List<Metric> {
  val canonical = listOf(
    "netWorth" to q.netWorth?.let { Metric(labels.netWorth, it, q.netWorthCompact ?: it, colors.text) },
    "spent" to q.spent?.let { Metric(labels.spent, it, q.spentCompact ?: it, colors.negative) },
    "earned" to q.earned?.let { Metric(labels.earned, it, q.earnedCompact ?: it, colors.positive) },
  )
  return canonical.filter { it.second != null }.map { it.first to it.second!! }.let { enabled ->
    val at = enabled.indexOfFirst { it.first == q.primary }.coerceAtLeast(0)
    (enabled.drop(at) + enabled.take(at)).map { it.second }
  }
}

class QuickAddWidget : QashyWidget(KIND_QUICK_ADD) {
  // Fixed sample data from string resources: the picker preview never shows the user's figures.
  override suspend fun providePreview(context: Context, widgetCategory: Int) {
    providePreviewContent(
      context,
      sampleLabels(context),
      QuickAddData(
        monthLabel = context.getString(R.string.qashy_preview_month),
        netWorth = context.getString(R.string.qashy_preview_net_worth_value),
        spent = context.getString(R.string.qashy_preview_spent_value),
        earned = context.getString(R.string.qashy_preview_earned_value),
        netWorthCompact = context.getString(R.string.qashy_preview_net_worth_compact),
        spentCompact = context.getString(R.string.qashy_preview_spent_compact),
        earnedCompact = context.getString(R.string.qashy_preview_earned_compact),
        primary = "netWorth",
      ),
    )
  }

  @Composable
  override fun Content(context: Context, snapshot: Snapshot, data: WidgetData, colors: WidgetColors, size: DpSize) {
    val q = data.payload as? QuickAddData ?: return
    val labels = snapshot.labels
    val cols = WidgetSizes.cols(size)
    val rows = WidgetSizes.rows(size)
    val fit = TextFit(context)
    val addAction = openAction(context, "qashy:///transaction")
    val overviewAction = openAction(context, "qashy:///overview")
    val metrics = orderedMetrics(q, labels, colors)

    when {
      // Nothing to show, or no room for it: the add button alone, the whole widget its target.
      metrics.isEmpty() || cols == 1 -> JustTheButton(labels, colors, addAction, drawn = if (rows == 1) BUTTON_DRAWN_SHORT else BUTTON_DRAWN)
      rows == 1 -> OneRow(labels, colors, metrics, cols, size, fit, addAction, overviewAction)
      else -> Tall(q, labels, colors, metrics, cols, rows, size, fit, addAction, overviewAction)
    }
  }
}

@Composable
private fun JustTheButton(labels: Labels, colors: WidgetColors, addAction: Action, drawn: Dp) {
  Box(
    modifier = GlanceModifier.fillMaxSize().clickable(addAction).semantics { contentDescription = labels.add },
    contentAlignment = Alignment.Center,
  ) {
    PlusButton(colors, drawn)
  }
}

/** One row: 2 cells wide shows one figure, 3 two side by side, 4 and 5 all of them. */
@Composable
private fun OneRow(
  labels: Labels,
  colors: WidgetColors,
  all: List<Metric>,
  cols: Int,
  size: DpSize,
  fit: TextFit,
  addAction: Action,
  overviewAction: Action,
) {
  val shown = all.take(if (cols == 2) 1 else if (cols == 3) 2 else 3)
  val space = size.width - EDGE - BUTTON_GAP - BUTTON_TOUCH - BUTTON_GAP
  val blockWidth = (space - BLOCK_GAP * (shown.size - 1)) / shown.size
  val valueSp = if (cols >= 4) 14 else 13

  // The row runs start to end, so the button sits at the end: on the right, and on the left in RTL.
  Row(
    modifier = GlanceModifier.fillMaxSize().padding(start = EDGE, end = BUTTON_GAP),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Row(
      modifier = GlanceModifier.defaultWeight().fillMaxHeight().clickable(overviewAction),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      shown.forEachIndexed { i, m ->
        if (i > 0) Spacer(modifier = GlanceModifier.width(BLOCK_GAP))
        StatBlock(m, colors, fit, blockWidth, valueSp, GlanceModifier.defaultWeight())
      }
    }
    Spacer(modifier = GlanceModifier.width(BUTTON_GAP))
    PlusButton(colors, BUTTON_DRAWN_SHORT, addAction, labels.add)
  }
}

/**
 * Two or more rows: the month and the add button on top, then the figures. Two cells wide they are
 * lines (label, amount), three wide the same but larger, four wide side by side under the month,
 * and with three rows large lines.
 */
@Composable
private fun Tall(
  q: QuickAddData,
  labels: Labels,
  colors: WidgetColors,
  metrics: List<Metric>,
  cols: Int,
  rows: Int,
  size: DpSize,
  fit: TextFit,
  addAction: Action,
  overviewAction: Action,
) {
  val inner = size.width - EDGE - EDGE
  val monthSp = if (cols <= 2) 11 else 12
  val month = fit.ellipsize(q.monthLabel, monthSp, false, inner - BUTTON_TOUCH - BUTTON_GAP)
  val blocks = cols >= 4 && rows == 2

  Column(
    modifier = GlanceModifier.fillMaxSize().padding(start = EDGE, end = EDGE, top = 6.dp, bottom = 6.dp),
  ) {
    Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
      Text(month, modifier = GlanceModifier.defaultWeight(), style = textStyle(colors.muted, monthSp), maxLines = 1)
      Spacer(modifier = GlanceModifier.width(BUTTON_GAP))
      PlusButton(colors, BUTTON_DRAWN, addAction, labels.add)
    }
    Column(
      modifier = GlanceModifier.fillMaxWidth().defaultWeight().clickable(overviewAction),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      if (blocks) {
        val blockWidth = (inner - BLOCK_GAP * (metrics.size - 1)) / metrics.size
        Row(modifier = GlanceModifier.fillMaxWidth()) {
          metrics.forEachIndexed { i, m ->
            if (i > 0) Spacer(modifier = GlanceModifier.width(BLOCK_GAP))
            StatBlock(m, colors, fit, blockWidth, 18, GlanceModifier.defaultWeight())
          }
        }
      } else {
        val labelSp = if (rows >= 3) 13 else if (cols <= 2) 11 else 12
        val valueSp = if (rows >= 3) 20 else if (cols >= 3) 14 else 12
        metrics.forEachIndexed { i, m ->
          if (i > 0) Spacer(modifier = GlanceModifier.height(if (rows >= 3) 8.dp else 2.dp))
          StatLine(m, colors, fit, inner, labelSp, valueSp)
        }
      }
    }
  }
}

/** The add button: an accent rounded square with a plus, both tinted so they follow day/night. */
@Composable
private fun PlusButton(colors: WidgetColors, drawn: Dp, action: Action? = null, description: String? = null) {
  var modifier = GlanceModifier.size(maxOf(BUTTON_TOUCH, drawn))
  if (action != null) modifier = modifier.clickable(action)
  if (description != null) modifier = modifier.semantics { contentDescription = description }
  Box(modifier = modifier, contentAlignment = Alignment.Center) {
    Image(
      provider = ImageProvider(R.drawable.qashy_squircle),
      contentDescription = null,
      modifier = GlanceModifier.size(drawn),
      colorFilter = ColorFilter.tint(colors.accent),
    )
    Image(
      provider = ImageProvider(R.drawable.qashy_plus),
      contentDescription = null,
      modifier = GlanceModifier.size(drawn / 2),
      colorFilter = ColorFilter.tint(colors.onAccent),
    )
  }
}

/** Label over amount; the amount is the full one when it fits [width], else the compact one. */
@Composable
private fun StatBlock(m: Metric, colors: WidgetColors, fit: TextFit, width: Dp, valueSp: Int, modifier: GlanceModifier) {
  Column(modifier = modifier) {
    Text(fit.ellipsize(m.label, 11, false, width), style = textStyle(colors.muted, 11), maxLines = 1)
    Text(fit.amount(m.full, m.compact, valueSp, true, width), style = textStyle(m.tone, valueSp, bold = true), maxLines = 1)
  }
}

/** Label at the start, amount at the end; the amount keeps its room and the label gives way. */
@Composable
private fun StatLine(m: Metric, colors: WidgetColors, fit: TextFit, width: Dp, labelSp: Int, valueSp: Int) {
  val labelWidth = fit.width(m.label, labelSp)
  val gap = 6.dp
  val value = if (fit.fits(m.full, valueSp, true, width - gap - minOf(labelWidth, 48f).dp)) {
    m.full
  } else {
    m.compact
  }
  val valueWidth = fit.width(value, valueSp, true).dp
  Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
    Text(
      fit.ellipsize(m.label, labelSp, false, width - valueWidth - gap),
      modifier = GlanceModifier.defaultWeight(),
      style = textStyle(colors.muted, labelSp),
      maxLines = 1,
    )
    Text(value, style = textStyle(m.tone, valueSp, bold = true, align = TextAlign.End), maxLines = 1)
  }
}

class QuickAddWidgetReceiver : QashyWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = QuickAddWidget()
}
