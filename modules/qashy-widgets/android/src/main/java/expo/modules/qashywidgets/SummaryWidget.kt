package expo.modules.qashywidgets

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.glance.ColorFilter
import androidx.glance.unit.ColorProvider
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.coerceIn
import androidx.compose.ui.unit.dp
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.ContentScale
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.text.Text
import androidx.glance.text.TextAlign

private val PADDING = 12.dp

class SummaryWidget : QashyWidget(KIND_SUMMARY) {
  @Composable
  override fun Content(context: Context, snapshot: Snapshot, data: WidgetData, colors: WidgetColors, size: DpSize) {
    val s = data.summary ?: return
    val labels = snapshot.labels
    val series = s.series?.filter { it.isFinite() }
    val showGraph = series != null && series.size >= 2 && size.width >= 250.dp && size.height >= 110.dp
    val wideStats = size.width >= 180.dp
    val density = context.resources.displayMetrics.density

    @Composable
    fun Stats() {
      Text(s.monthLabel, style = textStyle(colors.muted, 12), maxLines = 1)
      Text(s.netWorth, style = textStyle(colors.text, if (wideStats) 24 else 20, bold = true), maxLines = 1)
      Spacer(modifier = GlanceModifier.height(4.dp))
      if (wideStats && !showGraph) {
        Row(modifier = GlanceModifier.fillMaxWidth()) {
          StatBlock(labels.spent, s.spent, colors.negative, colors, GlanceModifier.defaultWeight())
          StatBlock(labels.earned, s.earned, colors.positive, colors, GlanceModifier.defaultWeight())
        }
      } else {
        StatLine(labels.spent, s.spent, colors.negative, colors)
        StatLine(labels.earned, s.earned, colors.positive, colors)
      }
    }

    @Composable
    fun Graph(widthDp: Dp, heightDp: Dp) {
      val bitmap = LineChart.render(series.orEmpty(), widthDp.value, heightDp.value, density)
      Image(
        provider = ImageProvider(bitmap),
        contentDescription = "${labels.netWorth}: ${s.seriesStart} - ${s.seriesEnd}",
        modifier = GlanceModifier.fillMaxWidth().height(heightDp),
        contentScale = ContentScale.FillBounds,
        // The bitmap is white; the tint is a day/night pair, so it follows dark mode by itself.
        colorFilter = ColorFilter.tint(colors.accent),
      )
      Row(modifier = GlanceModifier.fillMaxWidth()) {
        Text(s.seriesStart, modifier = GlanceModifier.defaultWeight(), style = textStyle(colors.muted, 10), maxLines = 1)
        Text(s.seriesEnd, style = textStyle(colors.muted, 10, align = TextAlign.End), maxLines = 1)
      }
    }

    when {
      showGraph && size.height >= 170.dp -> Column(modifier = GlanceModifier.fillMaxSize().padding(PADDING)) {
        Stats()
        Spacer(modifier = GlanceModifier.height(6.dp))
        Graph(size.width - PADDING * 2, (size.height - 134.dp).coerceIn(36.dp, 120.dp))
      }
      showGraph -> Row(modifier = GlanceModifier.fillMaxSize().padding(PADDING), verticalAlignment = Alignment.CenterVertically) {
        Column(modifier = GlanceModifier.defaultWeight()) { Stats() }
        Spacer(modifier = GlanceModifier.width(8.dp))
        Column(modifier = GlanceModifier.defaultWeight()) {
          Graph((size.width - PADDING * 2 - 8.dp) / 2, (size.height - PADDING * 2 - 16.dp).coerceIn(36.dp, 120.dp))
        }
      }
      else -> Column(
        modifier = GlanceModifier.fillMaxSize().padding(PADDING),
        verticalAlignment = Alignment.CenterVertically,
      ) { Stats() }
    }
  }
}

@Composable
private fun StatBlock(label: String, value: String, tone: ColorProvider, colors: WidgetColors, modifier: GlanceModifier) {
  Column(modifier = modifier) {
    Text(label, style = textStyle(colors.muted, 11), maxLines = 1)
    Text(value, style = textStyle(tone, 14, bold = true), maxLines = 1)
  }
}

@Composable
private fun StatLine(label: String, value: String, tone: ColorProvider, colors: WidgetColors) {
  Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
    Text(label, modifier = GlanceModifier.defaultWeight(), style = textStyle(colors.muted, 11), maxLines = 1)
    Text(value, style = textStyle(tone, 12, bold = true, align = TextAlign.End), maxLines = 1)
  }
}

class SummaryWidgetReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = SummaryWidget()

  override fun onDeleted(context: Context, appWidgetIds: IntArray) {
    super.onDeleted(context, appWidgetIds)
    WidgetScheduler.cleanupIfNoWidgets(context, appWidgetIds.toSet())
  }

  override fun onDisabled(context: Context) {
    super.onDisabled(context)
    WidgetScheduler.cleanupIfNoWidgets(context)
  }
}
