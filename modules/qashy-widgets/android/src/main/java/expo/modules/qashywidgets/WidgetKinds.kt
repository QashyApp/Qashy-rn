package expo.modules.qashywidgets

import androidx.glance.appwidget.GlanceAppWidgetReceiver
import org.json.JSONObject

/**
 * One widget kind on the native side. The id is the JS kind id and the key under which the kind's
 * data sits in its snapshot entry (`widgets[appWidgetId][id]`).
 */
class WidgetKind(
  val id: String,
  /** The receiver declared in the manifest for this kind. */
  val receiver: Class<out GlanceAppWidgetReceiver>,
  val widget: () -> QashyWidget,
  /** Reads the kind's data from its snapshot entry; the result is `WidgetData.payload`. */
  val parse: (JSONObject) -> Any?,
)

/**
 * Every widget kind. A new kind is one file with its widget, receiver and parser, one line here,
 * and the manifest receiver, provider XMLs and strings (see `AndroidManifest.xml`).
 */
object WidgetKinds {
  val all: List<WidgetKind> = listOf(
    WidgetKind(KIND_TRANSACTIONS, TransactionsWidgetReceiver::class.java, ::TransactionsWidget, ::parseTransactions),
    WidgetKind(KIND_SUMMARY, SummaryWidgetReceiver::class.java, ::SummaryWidget, ::parseSummary),
  )

  fun byId(id: String): WidgetKind? = all.firstOrNull { it.id == id }
}
