package expo.modules.qashywidgets

import android.content.Context
import android.graphics.Color
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
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
  val add: String,
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
  private const val VERSION = 2

  // Serializes writers (the temp file name is fixed) and keeps the flow in step with the file.
  private val lock = Any()
  private val state = MutableStateFlow<Snapshot?>(null)
  @Volatile private var loaded = false

  /**
   * The parsed snapshot, or null when there is none. Widget content must collect this inside
   * `provideContent`: anything read before it is frozen for the whole Glance session, and
   * `update()` does not re-run `provideGlance` on a live session. Call [load] first.
   */
  val flow: StateFlow<Snapshot?> = state.asStateFlow()

  fun dir(context: Context) = File(context.noBackupFilesDir, "qashy-widgets")
  private fun file(context: Context) = File(dir(context), "snapshot.json")

  fun exists(context: Context) = file(context).exists()

  /** The current snapshot; the first call reads the file off the main thread, later ones are free. */
  suspend fun load(context: Context): Snapshot? {
    if (!loaded) {
      withContext(Dispatchers.IO) {
        synchronized(lock) {
          if (!loaded) {
            state.value = readFile(context)
            loaded = true
          }
        }
      }
    }
    return state.value
  }

  /** Throws when the JSON is not a version-2 snapshot, so a bad write never replaces good data. */
  fun write(context: Context, json: String) {
    val parsed = requireNotNull(parse(json)) { "Not a version $VERSION widget snapshot" }
    synchronized(lock) {
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
      state.value = parsed
      loaded = true
    }
  }

  /** Erases the file and the in-memory copy together. */
  fun delete(context: Context) {
    synchronized(lock) {
      dir(context).deleteRecursively()
      state.value = null
      loaded = true
    }
  }

  private fun readFile(context: Context): Snapshot? =
    try {
      file(context).takeIf { it.exists() }?.readText(Charsets.UTF_8)?.let(::parse)
    } catch (e: Exception) {
      null
    }

  /** Null on a parse failure or any version other than 2; unknown fields are ignored. */
  fun parse(json: String): Snapshot? =
    try {
      val root = JSONObject(json)
      if (root.optInt("version", -1) != VERSION) {
        null
      } else {
        val l = root.getJSONObject("labels")
        val labels = Labels(
          l.optString("netWorth"), l.optString("spent"), l.optString("earned"),
          l.optString("add"), l.optString("openApp"),
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

/** The string at [name], or null when it is absent or JSON null (a value the widget does not show). */
internal fun JSONObject.optStringOrNull(name: String): String? = if (isNull(name)) null else optString(name)
