package expo.modules.qashywidgets

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.glance.ColorFilter
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.ContentScale
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.Text
import androidx.glance.text.TextAlign
import org.json.JSONObject

const val KIND_BUDGET = "budget"

private val BAR_HEIGHT = 7.dp
private val EDGE = 12.dp

/** Shown before the percentage or the status when spending is past the limit, so it never relies on color. */
private const val OVER_MARK = "⚠"

/**
 * One budget's progress, already formatted. With hidden amounts [spent], [limit] and [remaining]
 * (and their compact forms) are null; the percentage and the pace wording are always there.
 */
class BudgetData(
  val empty: Boolean,
  val name: String,
  val period: String,
  val percent: Int,
  val progress: Float,
  val elapsed: Float,
  val over: Boolean,
  val statusText: String,
  val spent: String?,
  val limit: String?,
  val remaining: String?,
  val spentCompact: String? = spent,
  val limitCompact: String? = limit,
  val remainingCompact: String? = remaining,
) {
  /**
   * How far past 100% the spending is, as a fraction of a lap (0.3 for 130%), capped by the meter
   * at one more lap. A budget flagged over that rounds to 100% still gets a sliver, so the
   * overflow lap is there.
   */
  val overflow: Float
    get() = when {
      percent > 100 -> ((percent - 100) / 100f).coerceAtMost(1f)
      over -> 0.03f
      else -> 0f
    }

  /** The part past the limit as words that need no translation: "+30%". */
  val overflowText: String? get() = if (percent > 100) "\u200E+${percent - 100}%" else null

  val percentText: String get() = "$percent%"

  /** What a screen reader says for the meter. */
  val description: String get() = "$name: $percent%, $statusText"
}

internal fun parseBudget(entry: JSONObject): BudgetData? =
  entry.optJSONObject("budget")?.let { o ->
    BudgetData(
      empty = o.optBoolean("empty", false),
      name = o.optString("name"),
      period = o.optString("period"),
      percent = o.optInt("percent", 0).coerceIn(0, 999),
      progress = o.optDouble("progress", 0.0).toFloat().coerceIn(0f, 1f),
      elapsed = o.optDouble("elapsed", 0.0).toFloat().coerceIn(0f, 1f),
      over = o.optBoolean("over", false),
      statusText = o.optString("statusText"),
      spent = o.optStringOrNull("spent"),
      limit = o.optStringOrNull("limit"),
      remaining = o.optStringOrNull("remaining"),
      spentCompact = o.optStringOrNull("spentCompact"),
      limitCompact = o.optStringOrNull("limitCompact"),
      remainingCompact = o.optStringOrNull("remainingCompact"),
    )
  }

class BudgetWidget : QashyWidget(KIND_BUDGET) {
  // The whole widget, whatever it shows, opens the plan.
  override val rootUri: String = "qashy:///plan"

  // Fixed sample data from string resources: the picker preview never shows the user's budget.
  override suspend fun providePreview(context: Context, widgetCategory: Int) {
    providePreviewContent(
      context,
      sampleLabels(context),
      BudgetData(
        empty = false,
        name = context.getString(R.string.qashy_preview_budget_name),
        period = context.getString(R.string.qashy_preview_month),
        percent = 62,
        progress = 0.62f,
        elapsed = 0.5f,
        over = false,
        statusText = context.getString(R.string.qashy_preview_budget_status),
        spent = context.getString(R.string.qashy_preview_budget_spent),
        limit = context.getString(R.string.qashy_preview_budget_limit),
        remaining = context.getString(R.string.qashy_preview_budget_remaining),
      ),
    )
  }

  @Composable
  override fun Content(context: Context, snapshot: Snapshot, data: WidgetData, colors: WidgetColors, size: DpSize) {
    val b = data.payload as? BudgetData ?: return
    val density = context.resources.displayMetrics.density
    val cols = WidgetSizes.cols(size)
    val rows = WidgetSizes.rows(size)
    val fit = TextFit(context)
    when {
      b.empty -> EmptyBudget(b, colors, fit, size)
      // One row: a ring that is only its percentage, or a bar with more and more around it.
      rows == 1 && cols == 1 -> MiniRing(b, colors, fit, size, density)
      rows == 1 -> BarLayout(b, colors, fit, size, cols, density)
      // Two or more rows: a ring, with its name under it when narrow and details beside it when wide.
      cols <= 2 -> RingWithName(b, colors, fit, size, density)
      else -> RingWithDetails(b, colors, fit, size, cols, rows, density)
    }
  }
}

@Composable
private fun EmptyBudget(b: BudgetData, colors: WidgetColors, fit: TextFit, size: DpSize) {
  val tiny = size.width < 100.dp
  Column(
    modifier = GlanceModifier.fillMaxSize().padding(if (tiny) 6.dp else EDGE),
    verticalAlignment = Alignment.CenterVertically,
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    Image(
      provider = ImageProvider(R.drawable.qashy_plus),
      contentDescription = null,
      modifier = GlanceModifier.size(if (tiny) 20.dp else 24.dp),
      colorFilter = ColorFilter.tint(colors.accent),
    )
    if (!tiny || size.height > 60.dp) {
      Spacer(modifier = GlanceModifier.height(4.dp))
      val sp = if (tiny) 11 else 14
      Text(
        if (size.height < 60.dp) fit.ellipsize(b.name, sp, true, size.width - EDGE * 2) else b.name,
        style = textStyle(colors.accent, sp, bold = true, align = TextAlign.Center),
        maxLines = if (size.height < 60.dp) 1 else 2,
      )
    }
  }
}

/** The ring (and its overflow lap) as stacked Images, bottom first. */
@Composable
private fun MeterRing(b: BudgetData, colors: WidgetColors, ringSize: Dp, density: Float) {
  val layers = remember(b.progress, b.overflow, b.elapsed, ringSize, density) {
    Meter.ring(b.progress, b.overflow, b.elapsed, ringSize.value, density)
  }
  MeterLayerImages(layers, b, colors, GlanceModifier.fillMaxSize())
}

@Composable
private fun MeterLayerImages(layers: MeterLayers, b: BudgetData, colors: WidgetColors, modifier: GlanceModifier) {
  val scale = if (modifier == GlanceModifier.fillMaxSize()) ContentScale.Fit else ContentScale.FillBounds
  Box(modifier = modifier) {
    Image(
      provider = ImageProvider(layers.base),
      contentDescription = b.description,
      modifier = modifier,
      contentScale = scale,
      colorFilter = ColorFilter.tint(colors.accent),
    )
    layers.shadow?.let {
      Image(
        provider = ImageProvider(it),
        contentDescription = null,
        modifier = modifier,
        contentScale = scale,
        colorFilter = ColorFilter.tint(colors.shadow),
      )
    }
    layers.overflow?.let {
      Image(
        provider = ImageProvider(it),
        contentDescription = null,
        modifier = modifier,
        contentScale = scale,
        colorFilter = ColorFilter.tint(colors.accentDeep),
      )
    }
  }
}

/** The ring with the percentage in its hole, sized so the text always fits inside. */
@Composable
private fun RingWithPercent(b: BudgetData, colors: WidgetColors, fit: TextFit, ringSize: Dp, density: Float) {
  val hole = Meter.ringHoleDp(ringSize.value)
  val text = b.percentText
  val sp = fit.largestSp(text, true, maxSp = 20, minSp = 8, max = (hole * 0.9f).dp)
  Box(modifier = GlanceModifier.size(ringSize), contentAlignment = Alignment.Center) {
    MeterRing(b, colors, ringSize, density)
    Text(text, style = textStyle(colors.text, sp, bold = true, align = TextAlign.Center), maxLines = 1)
  }
}

/** One cell: the ring and its percentage, nothing else. */
@Composable
private fun MiniRing(b: BudgetData, colors: WidgetColors, fit: TextFit, size: DpSize, density: Float) {
  val ringSize = minOf(size.width, size.height) - 8.dp
  Box(modifier = GlanceModifier.fillMaxSize(), contentAlignment = Alignment.Center) {
    RingWithPercent(b, colors, fit, ringSize, density)
    if (b.over) {
      // Outside the ring, in the corner, so the mark never competes with the percentage.
      Box(modifier = GlanceModifier.fillMaxSize().padding(top = 1.dp, end = 3.dp), contentAlignment = Alignment.TopEnd) {
        Text(OVER_MARK, style = textStyle(colors.negative, 10, bold = true), maxLines = 1)
      }
    }
  }
}

/**
 * One row tall. Two cells wide: name, percentage and the bar. Three: and what is left. Four and
 * five: and the pace wording beside it. Text is measured, never left to be cut off.
 */
@Composable
private fun BarLayout(b: BudgetData, colors: WidgetColors, fit: TextFit, size: DpSize, cols: Int, density: Float) {
  val inner = size.width - EDGE * 2
  val barWidth = inner
  val layers = remember(b.progress, b.overflow, b.elapsed, barWidth, density) {
    Meter.bar(b.progress, b.overflow, b.elapsed, barWidth.value, BAR_HEIGHT.value, density)
  }
  val titleSp = 12
  val percent = if (b.over && cols >= 3) "$OVER_MARK ${b.percentText}" else b.percentText
  val percentWidth = fit.width(percent, titleSp, true).dp
  val name = fit.ellipsize(b.name, titleSp, true, inner - percentWidth - 8.dp)
  val tall = cols >= 3

  Column(
    modifier = GlanceModifier.fillMaxSize().padding(horizontal = EDGE, vertical = if (tall) 2.dp else 6.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
      Text(name, modifier = GlanceModifier.defaultWeight(), style = textStyle(colors.text, titleSp, bold = true), maxLines = 1)
      Spacer(modifier = GlanceModifier.width(8.dp))
      Text(percent, style = textStyle(colors.text, titleSp, bold = true, align = TextAlign.End), maxLines = 1)
    }
    Spacer(modifier = GlanceModifier.height(if (tall) 2.dp else 4.dp))
    Box(modifier = GlanceModifier.fillMaxWidth().height(BAR_HEIGHT)) {
      MeterLayerImages(layers, b, colors, GlanceModifier.fillMaxWidth().height(BAR_HEIGHT))
    }
    if (tall) {
      Spacer(modifier = GlanceModifier.height(2.dp))
      val sp = 11
      val status = if (b.over) "$OVER_MARK ${b.statusText}" else b.statusText
      val statusColor = if (b.over) colors.negative else colors.muted
      val remaining = b.remaining?.let { fit.amount(it, b.remainingCompact ?: it, sp, true, inner) }
      Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        if (remaining != null) {
          val remainingWidth = fit.width(remaining, sp, true).dp
          if (cols >= 4) {
            Text(remaining, modifier = GlanceModifier.defaultWeight(), style = textStyle(colors.text, sp, bold = true), maxLines = 1)
            Spacer(modifier = GlanceModifier.width(8.dp))
            Text(
              fit.ellipsize(status, sp, b.over, inner - remainingWidth - 8.dp),
              style = textStyle(statusColor, sp, bold = b.over, align = TextAlign.End),
              maxLines = 1,
            )
          } else {
            Text(remaining, style = textStyle(colors.text, sp, bold = true), maxLines = 1)
          }
        } else {
          // Amounts are hidden: the pace wording alone.
          Text(fit.ellipsize(status, sp, b.over, inner), style = textStyle(statusColor, sp, bold = b.over), maxLines = 1)
        }
      }
    }
  }
}

/** Two cells wide, two or more rows: the ring, with the name under it. */
@Composable
private fun RingWithName(b: BudgetData, colors: WidgetColors, fit: TextFit, size: DpSize, density: Float) {
  val inner = size.width - 16.dp
  Column(
    modifier = GlanceModifier.fillMaxSize().padding(horizontal = 8.dp, vertical = 8.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    RingWithPercent(b, colors, fit, 72.dp, density)
    Spacer(modifier = GlanceModifier.height(4.dp))
    Text(
      fit.ellipsize(b.name, 13, true, inner),
      style = textStyle(colors.text, 13, bold = true, align = TextAlign.Center),
      maxLines = 1,
    )
    if (b.over) {
      Text(
        fit.ellipsize("$OVER_MARK ${b.statusText}", 11, true, inner),
        style = textStyle(colors.negative, 11, bold = true, align = TextAlign.Center),
        maxLines = 1,
      )
    }
  }
}

/** Three or more cells wide, two or more rows: the ring at the start, the details beside it. */
@Composable
private fun RingWithDetails(b: BudgetData, colors: WidgetColors, fit: TextFit, size: DpSize, cols: Int, rows: Int, density: Float) {
  val ringSize = if (rows >= 3) 104.dp else if (cols >= 4) 84.dp else 72.dp
  val gap = 12.dp
  val textWidth = size.width - EDGE * 2 - ringSize - gap
  val remaining = b.remaining?.let { fit.amount(it, b.remainingCompact ?: it, 14, true, textWidth) }
  // "+30%" only where there is room for it beside the wording; the ring already says 130%.
  val overflow = if (cols >= 4) b.overflowText else null

  Row(
    modifier = GlanceModifier.fillMaxSize().padding(EDGE),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    RingWithPercent(b, colors, fit, ringSize, density)
    Spacer(modifier = GlanceModifier.width(gap))
    Column(modifier = GlanceModifier.defaultWeight(), verticalAlignment = Alignment.CenterVertically) {
      Text(fit.ellipsize(b.name, 15, true, textWidth), style = textStyle(colors.text, 15, bold = true), maxLines = 1)
      if (b.period.isNotBlank()) {
        Text(fit.ellipsize(b.period, 11, false, textWidth), style = textStyle(colors.muted, 11), maxLines = 1)
      }
      Spacer(modifier = GlanceModifier.height(4.dp))
      remaining?.let { Text(it, style = textStyle(colors.text, 14, bold = true), maxLines = 1) }
      // Past the limit: how far, then the wording, each with room to spare or cut by measure.
      if (b.over) {
        val mark = if (overflow != null) "$OVER_MARK $overflow" else OVER_MARK
        val markWidth = fit.width(mark, 12, true).dp
        Row(verticalAlignment = Alignment.CenterVertically) {
          Text(mark, style = textStyle(colors.negative, 12, bold = true), maxLines = 1)
          Spacer(modifier = GlanceModifier.width(4.dp))
          Text(
            fit.ellipsize(b.statusText, 12, true, textWidth - markWidth - 4.dp),
            style = textStyle(colors.negative, 12, bold = true),
            maxLines = 1,
          )
        }
      } else {
        Text(fit.ellipsize(b.statusText, 12, false, textWidth), style = textStyle(colors.muted, 12), maxLines = 1)
      }
    }
  }
}

class BudgetWidgetReceiver : QashyWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = BudgetWidget()
}
