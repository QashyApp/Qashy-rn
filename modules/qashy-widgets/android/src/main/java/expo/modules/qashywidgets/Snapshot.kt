package expo.modules.qashywidgets

import android.content.Context
import android.graphics.Color
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream

/** One widget's palette, as ARGB ints. */
class Palette(
  val background: Int,
  val text: Int,
  val textMuted: Int,
  val accent: Int,
  val onAccent: Int,
  val positive: Int,
  val negative: Int,
  val border: Int,
)

class WidgetStyle(
  val theme: String,
  val mode: String,
  val background: String,
  val opacity: Int,
  val frosted: Boolean,
  val light: Palette,
  val dark: Palette,
)

class Labels(
  val netWorth: String,
  val spent: String,
  val earned: String,
  val upcoming: String,
  val recent: String,
  val add: String,
  val empty: String,
  val openApp: String,
)

class TxRow(val id: String, val title: String, val detail: String, val amount: String, val tone: String)
class TxGroup(val heading: String, val rows: List<TxRow>)
class TxData(val title: String, val groups: List<TxGroup>)

class SummaryData(
  val monthLabel: String,
  val netWorth: String,
  val spent: String,
  val earned: String,
  val series: List<Double>?,
  val seriesStart: String,
  val seriesEnd: String,
)

class WidgetData(val kind: String, val style: WidgetStyle, val transactions: TxData?, val summary: SummaryData?)

class Snapshot(val hideAmounts: Boolean, val labels: Labels, val widgets: Map<Int, WidgetData>)

/**
 * The snapshot JSON written by JS. It lives in noBackupFilesDir so finance data never reaches
 * backups or device transfer.
 */
object SnapshotStore {
  private const val VERSION = 1

  fun dir(context: Context) = File(context.noBackupFilesDir, "qashy-widgets")
  private fun file(context: Context) = File(dir(context), "snapshot.json")

  fun exists(context: Context) = file(context).exists()

  /** Throws when the JSON is not a version-1 snapshot, so a bad write never replaces good data. */
  fun write(context: Context, json: String) {
    requireNotNull(parse(json)) { "Not a version $VERSION widget snapshot" }
    val dir = dir(context).apply { mkdirs() }
    val tmp = File(dir, "snapshot.json.tmp")
    FileOutputStream(tmp).use {
      it.write(json.toByteArray(Charsets.UTF_8))
      it.fd.sync()
    }
    val dest = file(context)
    if (!tmp.renameTo(dest)) {
      dest.delete()
      check(tmp.renameTo(dest)) { "Could not store the widget snapshot" }
    }
  }

  fun read(context: Context): Snapshot? =
    try {
      file(context).takeIf { it.exists() }?.readText(Charsets.UTF_8)?.let(::parse)
    } catch (e: Exception) {
      null
    }

  fun delete(context: Context) {
    dir(context).deleteRecursively()
  }

  /** Null on a parse failure or any version other than 1; unknown fields are ignored. */
  fun parse(json: String): Snapshot? =
    try {
      val root = JSONObject(json)
      if (root.optInt("version", -1) != VERSION) {
        null
      } else {
        val l = root.getJSONObject("labels")
        val labels = Labels(
          l.optString("netWorth"), l.optString("spent"), l.optString("earned"),
          l.optString("upcoming"), l.optString("recent"), l.optString("add"),
          l.optString("empty"), l.optString("openApp"),
        )
        val widgets = HashMap<Int, WidgetData>()
        root.optJSONObject("widgets")?.let { ws ->
          ws.keys().forEach { key ->
            val id = key.toIntOrNull() ?: return@forEach
            // One malformed widget entry must not hide the others.
            runCatching { parseWidget(ws.getJSONObject(key)) }.getOrNull()?.let { widgets[id] = it }
          }
        }
        Snapshot(root.optBoolean("hideAmounts", false), labels, widgets)
      }
    } catch (e: Exception) {
      null
    }

  private fun parseWidget(o: JSONObject): WidgetData {
    val kind = o.getString("kind")
    require(kind == "transactions" || kind == "summary")
    val s = o.getJSONObject("style")
    val style = WidgetStyle(
      theme = s.optString("theme", "qashy"),
      mode = s.optString("mode", "system"),
      background = s.optString("background", "surface"),
      opacity = s.optInt("opacity", 100).coerceIn(0, 100),
      frosted = s.optBoolean("frosted", false),
      light = parsePalette(s.getJSONObject("light")),
      dark = parsePalette(s.getJSONObject("dark")),
    )
    return WidgetData(
      kind,
      style,
      o.optJSONObject("transactions")?.let(::parseTransactions),
      o.optJSONObject("summary")?.let(::parseSummary),
    )
  }

  private fun parsePalette(p: JSONObject): Palette {
    fun c(name: String): Int = Color.parseColor(p.getString(name))
    return Palette(
      c("background"), c("text"), c("textMuted"), c("accent"),
      c("onAccent"), c("positive"), c("negative"), c("border"),
    )
  }

  private fun parseTransactions(o: JSONObject): TxData {
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
    return TxData(o.optString("title"), groups)
  }

  private fun parseSummary(o: JSONObject): SummaryData {
    val arr = o.optJSONArray("series")
    val series = arr?.let { a -> (0 until a.length()).map { a.getDouble(it) } }
    return SummaryData(
      o.optString("monthLabel"), o.optString("netWorth"), o.optString("spent"),
      o.optString("earned"), series, o.optString("seriesStart"), o.optString("seriesEnd"),
    )
  }

  private fun JSONArray?.objects(): List<JSONObject> =
    if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }
}
