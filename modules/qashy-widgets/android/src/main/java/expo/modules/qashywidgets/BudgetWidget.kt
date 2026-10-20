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
import androidx.glance.appwidget.PreviewSizeMode
import androidx.glance.appwidget.SizeMode
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

/** From this height (two rows) the budget is a ring; shorter it is a bar. */
private val RING_MIN_HEIGHT = 110.dp

/** From this width the ring has its details beside it, and the bar a second line under it. */
private val DETAILS_MIN_WIDTH = 180.dp

private val BAR_HEIGHT = 8.dp

/** Shown before the percentage when spending is past the limit, so it never relies on color. */
private const val OVER_MARK = "⚠ "

/**
 * One budget's progress, already formatted. With hidden amounts [spent], [limit] and [remaining]
 * are null; the percentage and the pace wording are always there.
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
) {
  val percentLabel: String get() = "${if (over) OVER_MARK else ""}$percent%"

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
    )
  }

class BudgetWidget : QashyWidget(KIND_BUDGET) {
  // The whole widget, whatever it shows, opens the plan.
  override val rootUri: String = "qashy:///plan"

  override val sizeMode: SizeMode = SizeMode.Responsive(
    setOf(
      DpSize(110.dp, 40.dp),
      DpSize(180.dp, 40.dp),
      DpSize(250.dp, 40.dp),
      DpSize(110.dp, 110.dp),
      DpSize(180.dp, 110.dp),
      DpSize(250.dp, 110.dp),
      DpSize(250.dp, 180.dp),
    ),
  )

  override val previewSizeMode: PreviewSizeMode = SizeMode.Responsive(
    setOf(DpSize(250.dp, 40.dp), DpSize(180.dp, 110.dp)),
  )

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
    when {
      b.empty -> EmptyBudget(b, colors)
      size.height >= RING_MIN_HEIGHT -> RingLayout(b, colors, size, density)
      else -> BarLayout(b, colors, size, density)
    }
  }
}

@Composable
private fun EmptyBudget(b: BudgetData, colors: WidgetColors) {
  Column(
    modifier = GlanceModifier.fillMaxSize().padding(12.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    Image(
      provider = ImageProvider(R.drawable.qashy_plus),
      contentDescription = null,
      modifier = GlanceModifier.size(24.dp),
      colorFilter = ColorFilter.tint(colors.accent),
    )
    Spacer(modifier = GlanceModifier.height(4.dp))
    Text(b.name, style = textStyle(colors.accent, 14, bold = true, align = TextAlign.Center), maxLines = 2)
  }
}

@Composable
private fun BarLayout(b: BudgetData, colors: WidgetColors, size: DpSize, density: Float) {
  val barWidth = size.width - 24.dp
  val bar = remember(b.progress, b.elapsed, b.over, barWidth, density) {
    Meter.bar(b.progress, b.elapsed, b.over, barWidth.value, BAR_HEIGHT.value, density)
  }
  Column(
    modifier = GlanceModifier.fillMaxSize().padding(horizontal = 12.dp, vertical = 6.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
      Text(b.name, modifier = GlanceModifier.defaultWeight(), style = textStyle(colors.text, 13, bold = true), maxLines = 1)
      Spacer(modifier = GlanceModifier.width(8.dp))
      Text(
        b.percentLabel,
        style = textStyle(if (b.over) colors.negative else colors.text, 13, bold = true, align = TextAlign.End),
        maxLines = 1,
      )
    }
    Spacer(modifier = GlanceModifier.height(4.dp))
    Image(
      provider = ImageProvider(bar),
      contentDescription = b.description,
      modifier = GlanceModifier.fillMaxWidth().height(BAR_HEIGHT),
      contentScale = ContentScale.FillBounds,
      colorFilter = ColorFilter.tint(if (b.over) colors.negative else colors.accent),
    )
    if (size.width >= DETAILS_MIN_WIDTH) {
      Spacer(modifier = GlanceModifier.height(4.dp))
      Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(b.statusText, modifier = GlanceModifier.defaultWeight(), style = textStyle(colors.muted, 11), maxLines = 1)
        b.remaining?.let {
          Spacer(modifier = GlanceModifier.width(8.dp))
          Text(it, style = textStyle(colors.text, 11, bold = true, align = TextAlign.End), maxLines = 1)
        }
      }
    }
  }
}

@Composable
private fun RingLayout(b: BudgetData, colors: WidgetColors, size: DpSize, density: Float) {
  val wide = size.width >= DETAILS_MIN_WIDTH
  val ringSize: Dp = when {
    !wide -> 64.dp
    size.height >= 180.dp -> 104.dp
    else -> 76.dp
  }
  val ring = remember(b.progress, b.elapsed, b.over, ringSize, density) {
    Meter.ring(b.progress, b.elapsed, b.over, ringSize.value, density)
  }

  @Composable
  fun RingWithPercent() {
    Box(modifier = GlanceModifier.size(ringSize), contentAlignment = Alignment.Center) {
      Image(
        provider = ImageProvider(ring),
        contentDescription = b.description,
        modifier = GlanceModifier.fillMaxSize(),
        colorFilter = ColorFilter.tint(if (b.over) colors.negative else colors.accent),
      )
      Text(
        b.percentLabel,
        style = textStyle(if (b.over) colors.negative else colors.text, if (ringSize >= 76.dp) 16 else 13, bold = true, align = TextAlign.Center),
        maxLines = 1,
      )
    }
  }

  if (!wide) {
    Column(
      modifier = GlanceModifier.fillMaxSize().padding(8.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalAlignment = Alignment.CenterHorizontally,
    ) {
      RingWithPercent()
      Spacer(modifier = GlanceModifier.height(4.dp))
      Text(b.name, style = textStyle(colors.text, 12, bold = true, align = TextAlign.Center), maxLines = 1)
    }
    return
  }

  Row(
    modifier = GlanceModifier.fillMaxSize().padding(12.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    RingWithPercent()
    Spacer(modifier = GlanceModifier.width(12.dp))
    Column(modifier = GlanceModifier.defaultWeight(), verticalAlignment = Alignment.CenterVertically) {
      Text(b.name, style = textStyle(colors.text, 15, bold = true), maxLines = 1)
      if (b.period.isNotBlank()) Text(b.period, style = textStyle(colors.muted, 11), maxLines = 1)
      Spacer(modifier = GlanceModifier.height(4.dp))
      b.remaining?.let { Text(it, style = textStyle(colors.text, 14, bold = true), maxLines = 1) }
      Text(
        "${if (b.over) OVER_MARK else ""}${b.statusText}",
        style = textStyle(if (b.over) colors.negative else colors.muted, 12, bold = b.over),
        maxLines = 2,
      )
    }
  }
}

class BudgetWidgetReceiver : QashyWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = BudgetWidget()
}
