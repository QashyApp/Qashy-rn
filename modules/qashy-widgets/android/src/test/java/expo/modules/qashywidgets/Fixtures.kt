package expo.modules.qashywidgets

import org.json.JSONObject

/** Sample snapshots for the screenshot tests: English and Hebrew, normal and awkward data. */
internal object Fixtures {
  enum class Lang(val tag: String, val rtl: Boolean) { EN("en", false), HE("he", true) }

  private fun palette(vararg pairs: Pair<String, String>) = JSONObject().apply { pairs.forEach { put(it.first, it.second) } }

  private val LIGHT = palette(
    "background" to "#FFFFFF", "text" to "#1B1B1F", "textMuted" to "#5F6169", "accent" to "#5070FF",
    "onAccent" to "#FFFFFF", "positive" to "#1B7F4B", "negative" to "#B3261E", "border" to "#D9D9E0",
  )
  private val DARK = palette(
    "background" to "#121221", "text" to "#EDEDF4", "textMuted" to "#A8AAB5", "accent" to "#9DB0FF",
    "onAccent" to "#121221", "positive" to "#5FD39A", "negative" to "#FF8A80", "border" to "#3A3A4D",
  )

  private fun style(background: String, accentLight: String?, accentDark: String?) = JSONObject().apply {
    put("theme", "qashy")
    put("mode", "system")
    put("background", background)
    put("opacity", 100)
    put("frosted", false)
    put("light", JSONObject(LIGHT.toString()).also { if (accentLight != null) it.put("accent", accentLight) })
    put("dark", JSONObject(DARK.toString()).also { if (accentDark != null) it.put("accent", accentDark) })
  }

  class Labels(val netWorth: String, val spent: String, val earned: String, val add: String)

  private fun labels(lang: Lang) = when (lang) {
    Lang.EN -> Labels("Net worth", "Spent", "Income", "Add transaction")
    Lang.HE -> Labels("שווי נקי", "הוצאות", "הכנסה", "הוספת תנועה")
  }

  fun snapshot(lang: Lang, hide: Boolean, kind: String, payloadKey: String, payload: JSONObject, background: String = "surface", accentLight: String? = null, accentDark: String? = null): String {
    val l = labels(lang)
    val entry = JSONObject().apply {
      put("kind", kind)
      put("style", style(background, accentLight, accentDark))
      put(payloadKey, payload)
    }
    return JSONObject().apply {
      put("version", 4)
      put("generatedAt", "2026-07-15T10:00:00.000Z")
      put("hideAmounts", hide)
      put("labels", JSONObject().apply {
        put("netWorth", l.netWorth); put("spent", l.spent); put("earned", l.earned)
        put("add", l.add); put("openApp", "Open Qashy to load your widget")
      })
      put("widgets", JSONObject().put(WidgetRenderer.APP_WIDGET_ID.toString(), entry))
    }.toString()
  }

  // ---- Quick add ---------------------------------------------------------------------------

  class Scenario(val id: String, val build: (Lang) -> String)

  private fun quickAdd(
    lang: Lang,
    netWorth: String?, spent: String?, earned: String?,
    netWorthC: String?, spentC: String?, earnedC: String?,
    primary: String?, hide: Boolean = false,
  ) = snapshot(
    lang, hide, "quickAdd", "quickAdd",
    JSONObject().apply {
      put("monthLabel", if (lang == Lang.EN) "July 2026" else "יולי 2026")
      put("netWorth", netWorth ?: JSONObject.NULL); put("spent", spent ?: JSONObject.NULL); put("earned", earned ?: JSONObject.NULL)
      put("netWorthCompact", netWorthC ?: JSONObject.NULL); put("spentCompact", spentC ?: JSONObject.NULL); put("earnedCompact", earnedC ?: JSONObject.NULL)
      put("primary", primary ?: JSONObject.NULL)
    },
  )

  private fun cur(lang: Lang, number: String) = if (lang == Lang.EN) "$$number" else "$number ₪"

  /** The strings of the device case (USD, net worth -$57,306.00): full and compact forms. */
  val DEVICE_FULL = setOf("-$57,306.00", "$57,306.00")
  val DEVICE_COMPACT = setOf("-$57.3K", "$57.3K")

  val DEVICE_CASE = Scenario("device") { l ->
    quickAdd(l, "-$57,306.00", "$57,306.00", "$0.00", "-$57.3K", "$57.3K", "$0.00", "netWorth")
  }

  val QUICK_ADD = listOf(
    Scenario("normal") { l ->
      quickAdd(l, cur(l, "12,480.00"), cur(l, "1,320.50"), cur(l, "3,200.00"), cur(l, "12.5K"), cur(l, "1.3K"), cur(l, "3.2K"), "netWorth")
    },
    // Seven-figure amounts and a negative one: nothing may be cut mid-number.
    Scenario("large") { l ->
      quickAdd(l, "-" + cur(l, "1,234,567.89"), cur(l, "98,765.43"), cur(l, "245,000.00"), "-" + cur(l, "1.2M"), cur(l, "98.8K"), cur(l, "245K"), "netWorth")
    },
    Scenario("hidden") { l ->
      quickAdd(l, "•••", "•••", "•••", "•••", "•••", "•••", "netWorth", hide = true)
    },
    // Spent is the chosen small-widget metric: it comes first, then the next enabled one.
    Scenario("primaryspent") { l ->
      quickAdd(l, cur(l, "12,480.00"), cur(l, "1,320.50"), cur(l, "3,200.00"), cur(l, "12.5K"), cur(l, "1.3K"), cur(l, "3.2K"), "spent")
    },
    // Only one metric on.
    Scenario("onlyearned") { l ->
      quickAdd(l, null, null, cur(l, "3,200.00"), null, null, cur(l, "3.2K"), "earned")
    },
    // Every metric off: just the add button.
    Scenario("none") { l -> quickAdd(l, null, null, null, null, null, null, null) },
  )

  // ---- Budget ------------------------------------------------------------------------------

  private fun budget(
    lang: Lang, name: String, percent: Int, elapsed: Double = 0.0,
    spent: String?, limit: String?, remaining: String?,
    spentC: String?, limitC: String?, remainingC: String?,
    statusText: String, hide: Boolean = false, empty: Boolean = false,
    background: String = "surface", accentLight: String? = null, accentDark: String? = null,
  ) = snapshot(
    lang, hide, "budget", "budget",
    JSONObject().apply {
      put("empty", empty)
      put("name", name)
      put("period", if (empty) "" else if (lang == Lang.EN) "July 2026" else "יולי 2026")
      put("percent", percent)
      put("progress", (percent / 100.0).coerceAtMost(1.0))
      put("over", percent > 100)
      put("status", "onTrack")
      put("statusText", statusText)
      put("spent", spent ?: JSONObject.NULL); put("limit", limit ?: JSONObject.NULL); put("remaining", remaining ?: JSONObject.NULL)
      put("spentCompact", spentC ?: JSONObject.NULL); put("limitCompact", limitC ?: JSONObject.NULL); put("remainingCompact", remainingC ?: JSONObject.NULL)
    },
    background, accentLight, accentDark,
  )

  private fun name(lang: Lang) = if (lang == Lang.EN) "Groceries" else "מכולת"
  private fun longName(lang: Lang) =
    if (lang == Lang.EN) "Groceries, household supplies and pet food" else "מכולת, ציוד לבית ואוכל לחיות המחמד"
  private fun under(lang: Lang) = if (lang == Lang.EN) "Under pace" else "מתחת לקצב"
  fun overStatus(lang: Lang) = overText(lang)

  private fun overText(lang: Lang) = if (lang == Lang.EN) "Over budget" else "מעל התקציב"
  private fun left(lang: Lang, n: String) = if (lang == Lang.EN) "$$n left" else "$n ₪ נותרו"
  private fun over(lang: Lang, n: String) = if (lang == Lang.EN) "$$n over" else "$n ₪ מעל"

  val BUDGET = listOf(
    Scenario("under") { l ->
      budget(l, name(l), 62, 0.5, cur(l, "310.00"), cur(l, "500.00"), left(l, "190.00"), cur(l, "310"), cur(l, "500"), left(l, "190"), under(l))
    },
    Scenario("over130") { l ->
      budget(l, name(l), 130, 0.55, cur(l, "650.00"), cur(l, "500.00"), over(l, "150.00"), cur(l, "650"), cur(l, "500"), over(l, "150"), overText(l))
    },
    // Far past the limit: the second lap is closed, and must still read as a lap.
    Scenario("over819") { l ->
      budget(l, name(l), 819, 0.4, cur(l, "4,095.00"), cur(l, "500.00"), over(l, "3,595.00"), cur(l, "4.1K"), cur(l, "500"), over(l, "3.6K"), overText(l))
    },
    Scenario("over250") { l ->
      budget(l, name(l), 250, 0.4, cur(l, "1,250.00"), cur(l, "500.00"), over(l, "750.00"), cur(l, "1.3K"), cur(l, "500"), over(l, "750"), overText(l))
    },
    // At the limit exactly, and a long name with a large amount.
    Scenario("full100") { l ->
      budget(l, name(l), 100, 0.9, cur(l, "500.00"), cur(l, "500.00"), left(l, "0.00"), cur(l, "500"), cur(l, "500"), left(l, "0"), under(l))
    },
    Scenario("longname") { l ->
      budget(l, longName(l), 85, 0.7, cur(l, "42,500.00"), cur(l, "50,000.00"), left(l, "7,500.00"), cur(l, "42.5K"), cur(l, "50K"), left(l, "7.5K"), under(l))
    },
    Scenario("longover") { l ->
      budget(l, longName(l), 140, 0.7, cur(l, "70,000.00"), cur(l, "50,000.00"), over(l, "20,000.00"), cur(l, "70K"), cur(l, "50K"), over(l, "20K"), overText(l))
    },
    Scenario("hidden") { l ->
      budget(l, name(l), 130, 0.55, null, null, null, null, null, null, overText(l), hide = true)
    },
    Scenario("empty") { l ->
      budget(l, if (l == Lang.EN) "Create a budget" else "יצירת תקציב", 0, 0.0, null, null, null, null, null, null, "", empty = true)
    },
    // Over budget on an accent-colored surface and with an orange accent.
    Scenario("over130accentbg") { l ->
      budget(l, name(l), 130, 0.55, cur(l, "650.00"), cur(l, "500.00"), over(l, "150.00"), cur(l, "650"), cur(l, "500"), over(l, "150"), overText(l), background = "accent")
    },
    Scenario("over130orange") { l ->
      budget(l, name(l), 130, 0.55, cur(l, "650.00"), cur(l, "500.00"), over(l, "150.00"), cur(l, "650"), cur(l, "500"), over(l, "150"), overText(l), accentLight = "#E65100", accentDark = "#FFB74D")
    },
  )
}
