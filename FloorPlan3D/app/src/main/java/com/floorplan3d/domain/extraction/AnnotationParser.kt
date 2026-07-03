package com.floorplan3d.domain.extraction

import com.floorplan3d.core.PlanLog
import com.floorplan3d.core.PlanLogger
import com.floorplan3d.domain.model.Dimension
import com.floorplan3d.domain.model.ElevationMark
import com.floorplan3d.domain.model.MaterialType

/** One recognised OCR text line with the centre of its bounding box in image pixels. */
data class OcrLine(val text: String, val centerXPx: Float = 0f, val centerYPx: Float = 0f)

/** Everything the parser could pull out of the plan's text annotations. */
data class ParsedAnnotations(
    val dimensions: List<Dimension>,
    val elevations: List<ElevationMark>,
    val scaleRatio: Int?,
    val wallHeightMm: Double?,
    val materials: Set<MaterialType>,
    val warnings: List<String>,
)

/**
 * Parses architectural annotations from OCR output: linear dimensions
 * (feet-inches, metric, bare-millimetre room sizes), elevation/level marks,
 * scale indicators and material call-outs.
 *
 * Pure Kotlin: unit-testable on the JVM without an OCR engine.
 */
class AnnotationParser(private val log: PlanLogger = PlanLog) {

    fun parse(lines: List<OcrLine>): ParsedAnnotations {
        val dimensions = mutableListOf<Dimension>()
        val elevations = mutableListOf<ElevationMark>()
        val materials = mutableSetOf<MaterialType>()
        val warnings = mutableListOf<String>()
        var scaleRatio: Int? = null
        var wallHeightMm: Double? = null

        for (line in lines) {
            val text = normalise(line.text)
            if (text.isBlank()) continue

            scaleRatio = scaleRatio ?: parseScale(text)

            val height = parseHeight(text)
            if (height != null) {
                wallHeightMm = maxOf(wallHeightMm ?: 0.0, height)
                continue // a height annotation should not also count as a plan dimension
            }

            val elevationMarks = parseElevations(text, line)
            if (elevationMarks.isNotEmpty()) {
                elevations += elevationMarks
                continue
            }

            dimensions += parseDimensions(text, line)
            materials += parseMaterials(text)
        }

        val sane = dimensions.filter { it.valueMm in MIN_DIMENSION_MM..MAX_DIMENSION_MM }
        if (sane.size < dimensions.size) {
            warnings += "${dimensions.size - sane.size} annotation(s) were outside the plausible " +
                "range ${MIN_DIMENSION_MM.toInt()}–${MAX_DIMENSION_MM.toInt()} mm and were ignored"
        }
        if (sane.isEmpty()) warnings += "No dimension annotations recognised; scale will be estimated"
        if (materials.isEmpty()) warnings += "No material call-outs recognised; using standard material set"

        log.d(TAG, "Parsed ${sane.size} dimensions, ${elevations.size} elevations, " +
            "scale=${scaleRatio?.let { "1:$it" } ?: "none"}, height=${wallHeightMm ?: "none"}, " +
            "materials=${materials.joinToString { it.name }}")

        return ParsedAnnotations(sane, elevations, scaleRatio, wallHeightMm, materials, warnings)
    }

    /** Fixes common OCR confusions before matching. */
    private fun normalise(raw: String): String = raw
        .replace('’', '\'').replace('‘', '\'').replace('`', '\'')
        .replace('”', '"').replace('“', '"')
        .replace('×', 'x')
        .replace(Regex("(?<=\\d)[Oo](?=\\d)"), "0") // 1O0 -> 100
        .trim()

    private fun parseScale(text: String): Int? {
        SCALE_REGEX.find(text)?.let { m ->
            val ratio = m.groupValues[1].toIntOrNull()
            if (ratio != null && ratio in 10..2000) {
                log.d(TAG, "Scale indicator found: 1:$ratio in \"$text\"")
                return ratio
            }
        }
        return null
    }

    private fun parseHeight(text: String): Double? {
        val m = HEIGHT_REGEX.find(text) ?: return null
        val mm = parseSingleLength(m.groupValues[1]) ?: return null
        return if (mm in 2000.0..6000.0) mm else null
    }

    private fun parseElevations(text: String, line: OcrLine): List<ElevationMark> =
        ELEVATION_REGEX.findAll(text).mapNotNull { m ->
            val label = m.groupValues[1].uppercase().trimEnd('.', ':')
            val value = m.groupValues[2].replace(",", "").toDoubleOrNull() ?: return@mapNotNull null
            val unit = m.groupValues[3].lowercase()
            // Level marks are metres unless explicitly mm or implausibly large for metres.
            val mm = when {
                unit == "mm" -> value
                unit == "m" -> value * 1000
                kotlin.math.abs(value) >= 100 -> value // "+450" without unit: treat as mm
                else -> value * 1000
            }
            ElevationMark(mm, label, m.value, line.centerXPx, line.centerYPx)
        }.toList()

    private fun parseDimensions(text: String, line: OcrLine): List<Dimension> {
        val result = mutableListOf<Dimension>()

        // Room sizes like "3600 X 4200" (bare mm) or "12'0" x 10'6""
        ROOM_SIZE_MM_REGEX.findAll(text).forEach { m ->
            val a = m.groupValues[1].toDoubleOrNull()
            val b = m.groupValues[2].toDoubleOrNull()
            if (a != null && b != null) {
                result += Dimension(a, m.value, line.centerXPx, line.centerYPx)
                result += Dimension(b, m.value, line.centerXPx, line.centerYPx)
            }
        }
        if (result.isNotEmpty()) return result

        FEET_INCHES_REGEX.findAll(text).forEach { m ->
            val feet = m.groupValues[1].toDoubleOrNull() ?: return@forEach
            val inches = m.groupValues[2].toDoubleOrNull() ?: 0.0
            result += Dimension(feet * MM_PER_FOOT + inches * MM_PER_INCH, m.value,
                line.centerXPx, line.centerYPx)
        }

        METRIC_REGEX.findAll(text).forEach { m ->
            val value = m.groupValues[1].replace(",", "").toDoubleOrNull() ?: return@forEach
            val mm = when (m.groupValues[2].lowercase()) {
                "mm" -> value
                "cm" -> value * 10
                else -> value * 1000
            }
            result += Dimension(mm, m.value, line.centerXPx, line.centerYPx)
        }

        return result
    }

    private fun parseMaterials(text: String): Set<MaterialType> {
        val upper = text.uppercase()
        return MATERIAL_KEYWORDS.filterKeys { keyword ->
            Regex("\\b$keyword").containsMatchIn(upper)
        }.values.toSet()
    }

    private fun parseSingleLength(raw: String): Double? {
        val text = raw.trim()
        FEET_INCHES_REGEX.find(text)?.let { m ->
            val feet = m.groupValues[1].toDoubleOrNull() ?: return@let
            val inches = m.groupValues[2].toDoubleOrNull() ?: 0.0
            return feet * MM_PER_FOOT + inches * MM_PER_INCH
        }
        METRIC_REGEX.find(text)?.let { m ->
            val value = m.groupValues[1].replace(",", "").toDoubleOrNull() ?: return@let
            return when (m.groupValues[2].lowercase()) {
                "mm" -> value
                "cm" -> value * 10
                else -> value * 1000
            }
        }
        val bare = text.toDoubleOrNull() ?: return null
        return if (bare > 100) bare else bare * 1000 // bare small numbers are metres
    }

    companion object {
        private const val TAG = "AnnotationParser"
        const val MM_PER_FOOT = 304.8
        const val MM_PER_INCH = 25.4
        const val MIN_DIMENSION_MM = 300.0
        const val MAX_DIMENSION_MM = 60_000.0

        // 12'  |  12'-6"  |  12' 6"  |  12'6"
        private val FEET_INCHES_REGEX =
            Regex("""(\d{1,3})\s*'\s*(?:-\s*)?(\d{1,2}(?:\.\d+)?)?\s*(?:"|'')?""")

        // 3.6 m | 3600 mm | 360cm | 3,600 MM
        private val METRIC_REGEX =
            Regex("""(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*(mm|cm|m)\b""", RegexOption.IGNORE_CASE)

        // 3600 x 4200  (bare-mm room size, common on Indian plans)
        private val ROOM_SIZE_MM_REGEX =
            Regex("""(\d{3,5})\s*[xX]\s*(\d{3,5})""")

        // EL +3.00 | FFL: 0.450 | LVL +450 mm | ELEV. -0.60
        private val ELEVATION_REGEX = Regex(
            """\b(EL|ELEV|ELEVATION|LVL|LEVEL|FFL|FGL|SFL|SSL|PLINTH)[.:\s]*([+-]?\d+(?:[.,]\d+)?)\s*(mm|m)?\b""",
            RegexOption.IGNORE_CASE
        )

        // CEILING HT 3.0M | CLG. HEIGHT: 10'-0" | WALL HT 3000mm
        private val HEIGHT_REGEX = Regex(
            """(?:CEILING|CLG|WALL|FLOOR)?\.?\s*\b(?:HT|HEIGHT)\b[.:\s]*([\d'."\s\-]+(?:mm|cm|m)?)""",
            RegexOption.IGNORE_CASE
        )

        // SCALE 1:100 | SCALE - 1:50 | 1:100 (standalone)
        private val SCALE_REGEX = Regex("""\b1\s*[:=]\s*(\d{1,4})\b""")

        private val MATERIAL_KEYWORDS: Map<String, MaterialType> = mapOf(
            "BRICK" to MaterialType.BRICK,
            "MASONRY" to MaterialType.BRICK,
            "AAC" to MaterialType.BRICK,
            "CEMENT" to MaterialType.CEMENT,
            "MORTAR" to MaterialType.CEMENT,
            "SAND" to MaterialType.SAND,
            "AGGREGATE" to MaterialType.AGGREGATE,
            "STEEL" to MaterialType.STEEL,
            "TMT" to MaterialType.STEEL,
            "REBAR" to MaterialType.STEEL,
            "RCC" to MaterialType.CONCRETE,
            "CONCRETE" to MaterialType.CONCRETE,
            "PCC" to MaterialType.CONCRETE,
            "TILE" to MaterialType.TILE,
            "VITRIFIED" to MaterialType.TILE,
            "CERAMIC" to MaterialType.TILE,
            "PAINT" to MaterialType.PAINT,
            "EMULSION" to MaterialType.PAINT,
            "TIMBER" to MaterialType.TIMBER,
            "WOOD" to MaterialType.TIMBER,
            "TEAK" to MaterialType.TIMBER,
            "GLASS" to MaterialType.GLASS,
            "GLAZING" to MaterialType.GLASS,
            "GYPSUM" to MaterialType.GYPSUM,
            "POP" to MaterialType.GYPSUM,
            "MARBLE" to MaterialType.MARBLE,
            "GRANITE" to MaterialType.MARBLE,
        )
    }
}
