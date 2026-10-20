package expo.modules.qashywidgets

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.glance.ColorFilter
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.PreviewSizeMode
import androidx.glance.appwidget.SizeMode
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

/** Narrower than this (about one or two cells) the widget is the add button and nothing else. */
private val METRICS_MIN_WIDTH = 130.dp

/** From this width the metrics sit side by side, label over amount; narrower they are stacked lines. */
private val BLOCKS_MIN_WIDTH = 250.dp

/** From this height (two rows) the month is named above the metrics. */
private val TALL_MIN_HEIGHT = 110.dp

private val BUTTON_SIZE = 48.dp

/** A metric the user switched off is null; the amounts are already masked when amounts are hidden. */
class QuickAddData(
  val monthLabel: String,
  val netWorth: String?,
  val spent: String?,
  val earned: String?,
) {
  val hasMetrics: Boolean get() = netWorth != null || spent != null || earned != null
}

internal fun parseQuickAdd(entry: JSONObject): QuickAddData? =
  entry.optJSONObject("quickAdd")?.let { o ->
    QuickAddData(
      o.optString("monthLabel"),
      o.optStringOrNull("netWorth"),
      o.optStringOrNull("spent"),
      o.optStringOrNull("earned"),
    )
  }

private class Metric(val label: String, val value: String, val tone: ColorProvider)

class QuickAddWidget : QashyWidget(KIND_QUICK_ADD) {
  // 1x1 up to 4x2. LocalSize is the chosen size below, not the live one: 40dp is "up to two cells".
  override val sizeMode: SizeMode = SizeMode.Responsive(
    setOf(
      DpSize(40.dp, 40.dp),
      DpSize(180.dp, 40.dp),
      DpSize(250.dp, 40.dp),
      DpSize(180.dp, 110.dp),
      DpSize(250.dp, 110.dp),
    ),
  )

  override val previewSizeMode: PreviewSizeMode = SizeMode.Responsive(
    setOf(DpSize(180.dp, 40.dp), DpSize(250.dp, 110.dp)),
  )

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
      ),
    )
  }

  @Composable
  override fun Content(context: Context, snapshot: Snapshot, data: WidgetData, colors: WidgetColors, size: DpSize) {
    val q = data.payload as? QuickAddData ?: return
    val labels = snapshot.labels
    val addAction = openAction(context, "qashy:///transaction")

    if (!q.hasMetrics || size.width < METRICS_MIN_WIDTH) {
      // Only the button, centered; the whole widget is its touch target.
      Box(
        modifier = GlanceModifier.fillMaxSize()
          .clickable(addAction)
          .semantics { contentDescription = labels.add },
        contentAlignment = Alignment.Center,
      ) {
        PlusButton(colors)
      }
      return
    }

    val metrics = buildList {
      q.netWorth?.let { add(Metric(labels.netWorth, it, colors.text)) }
      q.spent?.let { add(Metric(labels.spent, it, colors.negative)) }
      q.earned?.let { add(Metric(labels.earned, it, colors.positive)) }
    }
    val tall = size.height >= TALL_MIN_HEIGHT
    val blocks = size.width >= BLOCKS_MIN_WIDTH

    // Row order is start to end, so the button sits at the end: on the right, and on the left in RTL.
    Row(
      modifier = GlanceModifier.fillMaxSize().padding(horizontal = 12.dp, vertical = 6.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Column(
        modifier = GlanceModifier.defaultWeight().fillMaxHeight().clickable(openAction(context, "qashy:///overview")),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        if (tall) {
          Text(q.monthLabel, style = textStyle(colors.muted, 12), maxLines = 1)
          Spacer(modifier = GlanceModifier.height(4.dp))
        }
        if (blocks) {
          Row(modifier = GlanceModifier.fillMaxWidth()) {
            metrics.forEach { m -> StatBlock(m, colors, tall, GlanceModifier.defaultWeight()) }
          }
        } else {
          metrics.forEach { m -> StatLine(m, colors, tall) }
        }
      }
      Spacer(modifier = GlanceModifier.width(8.dp))
      Box(
        modifier = GlanceModifier.clickable(addAction).semantics { contentDescription = labels.add },
        contentAlignment = Alignment.Center,
      ) {
        PlusButton(colors)
      }
    }
  }
}

/** The add button: an accent rounded square with a plus, both tinted so they follow day/night. */
@Composable
private fun PlusButton(colors: WidgetColors) {
  Box(modifier = GlanceModifier.size(BUTTON_SIZE), contentAlignment = Alignment.Center) {
    Image(
      provider = ImageProvider(R.drawable.qashy_squircle),
      contentDescription = null,
      modifier = GlanceModifier.fillMaxSize(),
      colorFilter = ColorFilter.tint(colors.accent),
    )
    Image(
      provider = ImageProvider(R.drawable.qashy_plus),
      contentDescription = null,
      modifier = GlanceModifier.size(24.dp),
      colorFilter = ColorFilter.tint(colors.onAccent),
    )
  }
}

@Composable
private fun StatBlock(m: Metric, colors: WidgetColors, tall: Boolean, modifier: GlanceModifier) {
  Column(modifier = modifier) {
    Text(m.label, style = textStyle(colors.muted, 11), maxLines = 1)
    Text(m.value, style = textStyle(m.tone, if (tall) 16 else 14, bold = true), maxLines = 1)
  }
}

@Composable
private fun StatLine(m: Metric, colors: WidgetColors, tall: Boolean) {
  Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
    Text(m.label, modifier = GlanceModifier.defaultWeight(), style = textStyle(colors.muted, 11), maxLines = 1)
    Text(m.value, style = textStyle(m.tone, if (tall) 14 else 12, bold = true, align = TextAlign.End), maxLines = 1)
  }
}

class QuickAddWidgetReceiver : QashyWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = QuickAddWidget()
}
