package expo.modules.qashywidgets

import android.content.Context
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.glance.GlanceModifier
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.lazy.LazyColumn
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
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
import org.json.JSONObject

const val KIND_TRANSACTIONS = "transactions"

private const val MAX_ENTRIES = 80

class TxRow(val id: String, val title: String, val detail: String, val amount: String, val tone: String)
class TxGroup(val heading: String, val rows: List<TxRow>)
class TxData(val title: String, val groups: List<TxGroup>)

internal fun parseTransactions(entry: JSONObject): TxData? =
  entry.optJSONObject("transactions")?.let { o ->
    val groups = o.optJSONArray("groups").objects().map { g ->
      TxGroup(
        g.optString("heading"),
        g.optJSONArray("rows").objects().map { r ->
          TxRow(
            r.optString("id"), r.optString("title"), r.optString("detail"),
            r.optString("amount"), r.optString("tone", "neutral"),
          )
        },
      )
    }
    TxData(o.optString("title"), groups)
  }

private sealed interface Entry {
  class Heading(val text: String) : Entry
  class Item(val row: TxRow) : Entry
}

class TransactionsWidget : QashyWidget(KIND_TRANSACTIONS) {
  @Composable
  override fun Content(context: Context, snapshot: Snapshot, data: WidgetData, colors: WidgetColors, size: DpSize) {
    val tx = data.payload as? TxData
    val labels = snapshot.labels
    val entries = buildList<Entry> {
      tx?.groups?.forEach { g ->
        if (g.rows.isNotEmpty()) {
          if (g.heading.isNotBlank()) add(Entry.Heading(g.heading))
          g.rows.forEach { add(Entry.Item(it)) }
        }
      }
    }.take(MAX_ENTRIES)
    val showDetail = size.width >= 180.dp

    Column(modifier = GlanceModifier.fillMaxSize().padding(start = 12.dp, end = 4.dp, top = 4.dp, bottom = 8.dp)) {
      Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Box(
          modifier = GlanceModifier.defaultWeight().height(48.dp)
            .clickable(openAction(context, "qashy:///transactions")),
          contentAlignment = Alignment.CenterStart,
        ) {
          Text(tx?.title.orEmpty(), style = textStyle(colors.text, 16, bold = true), maxLines = 1)
        }
        Box(
          modifier = GlanceModifier.size(48.dp)
            .clickable(openAction(context, "qashy:///transaction"))
            .semantics { contentDescription = labels.add },
          contentAlignment = Alignment.Center,
        ) {
          Text("+", style = textStyle(colors.accent, 26, bold = true))
        }
      }
      if (entries.isEmpty()) {
        Box(modifier = GlanceModifier.fillMaxSize().padding(end = 8.dp), contentAlignment = Alignment.Center) {
          Text(labels.empty, style = textStyle(colors.muted, 13, align = TextAlign.Center), maxLines = 3)
        }
      } else {
        LazyColumn(modifier = GlanceModifier.fillMaxWidth().defaultWeight()) {
          items(entries.size) { index ->
            when (val e = entries[index]) {
              is Entry.Heading -> Text(
                e.text,
                modifier = GlanceModifier.fillMaxWidth().padding(top = 8.dp, bottom = 2.dp),
                style = textStyle(colors.muted, 12, bold = true),
                maxLines = 1,
              )
              is Entry.Item -> {
                val row = e.row
                val hasDetail = showDetail && row.detail.isNotBlank()
                Row(
                  modifier = GlanceModifier.fillMaxWidth()
                    .padding(end = 8.dp, top = if (hasDetail) 8.dp else 12.dp, bottom = if (hasDetail) 8.dp else 12.dp)
                    .clickable(openAction(context, "qashy:///transaction?id=${Uri.encode(row.id)}")),
                  verticalAlignment = Alignment.CenterVertically,
                ) {
                  Column(modifier = GlanceModifier.defaultWeight()) {
                    Text(row.title, style = textStyle(colors.text, 14), maxLines = 1)
                    if (hasDetail) Text(row.detail, style = textStyle(colors.muted, 12), maxLines = 1)
                  }
                  Spacer(modifier = GlanceModifier.width(8.dp))
                  Text(
                    row.amount,
                    style = textStyle(colors.tone(row.tone), 14, bold = true, align = TextAlign.End),
                    maxLines = 1,
                  )
                }
              }
            }
          }
        }
      }
    }
  }
}

class TransactionsWidgetReceiver : QashyWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = TransactionsWidget()
}
