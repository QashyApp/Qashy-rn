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

/**
 * One placed widget's data. `payload` is the kind's own parsed part of the entry (see
 * `WidgetKind.parse`); the kind's widget casts it to the type its parser returns.
 */
class WidgetData(val kind: String, val style: WidgetStyle, val payload: Any?)

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

  /** The parsed file as of the last write or read; every widget render would otherwise parse it again. */
  private class Cached(val length: Long, val modified: Long, val snapshot: Snapshot)

  @Volatile private var cached: Cached? = null

  /** Throws when the JSON is not a version-1 snapshot, so a bad write never replaces good data. */
  fun write(context: Context, json: String) {
    val parsed = requireNotNull(parse(json)) { "Not a version $VERSION widget snapshot" }
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
    cached = Cached(dest.length(), dest.lastModified(), parsed)
  }

  /** Reads through the cache while the file is the one that was cached (same size and time). */
  fun read(context: Context): Snapshot? =
    try {
      val file = file(context)
      if (!file.exists()) {
        cached = null
        null
      } else {
        val length = file.length()
        val modified = file.lastModified()
        cached?.takeIf { it.length == length && it.modified == modified }?.snapshot
          ?: file.readText(Charsets.UTF_8).let(::parse)?.also { cached = Cached(length, modified, it) }
      }
    } catch (e: Exception) {
      null
    }

  fun delete(context: Context) {
    cached = null
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
    val kind = requireNotNull(WidgetKinds.byId(o.getString("kind"))) { "Unknown widget kind" }
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
    return WidgetData(kind.id, style, kind.parse(o))
  }

  private fun parsePalette(p: JSONObject): Palette {
    fun c(name: String): Int = Color.parseColor(p.getString(name))
    return Palette(
      c("background"), c("text"), c("textMuted"), c("accent"),
      c("onAccent"), c("positive"), c("negative"), c("border"),
    )
  }
}

internal fun JSONArray?.objects(): List<JSONObject> =
  if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }
