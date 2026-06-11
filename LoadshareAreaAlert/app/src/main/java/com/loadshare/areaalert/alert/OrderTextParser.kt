package com.loadshare.areaalert.alert

import com.loadshare.areaalert.model.DeliveryPlatform

// Pure text-parsing logic extracted from AlertManager so it can be unit-tested
// without any Android dependencies. Every function here is side-effect free.
object OrderTextParser {

    // Keyword matching only considers short lines (≤60 chars) — area names embedded
    // inside long geocoded address strings cause false positives.
    fun shortLineText(fullText: String): String = fullText.lines()
        .map { it.trim() }
        .filter { it.length in 2..60 }
        .joinToString("\n")

    fun containsExcludedKeyword(shortLineText: String, excludedKeywords: List<String>): Boolean =
        excludedKeywords.any { kw -> shortLineText.contains(kw, ignoreCase = true) }

    fun findMatchedKeyword(shortLineText: String, enabledKeywords: List<String>): String? =
        enabledKeywords.firstOrNull { keyword ->
            shortLineText.contains(keyword, ignoreCase = true)
        }

    fun isWithinWorkingHours(enabled: Boolean, startHour: Int, endHour: Int, currentHour: Int): Boolean {
        if (!enabled) return true
        // Handle schedules that cross midnight (e.g. 22:00–06:00)
        return if (startHour <= endHour) {
            currentHour in startHour until endHour
        } else {
            currentHour >= startHour || currentHour < endHour
        }
    }

    fun parseAmountValue(amountStr: String): Int =
        Regex("""\d+""").find(amountStr)?.value?.toIntOrNull() ?: 0

    fun parseDistanceValue(distanceStr: String): Double =
        Regex("""(\d+\.?\d*)""").find(distanceStr)?.value?.toDoubleOrNull() ?: 0.0

    fun extractDistance(text: String): String? {
        val pattern = Regex("""(\d+\.?\d*)\s*(km|kilometer|kilometers|kms|mi|miles)""", RegexOption.IGNORE_CASE)
        return pattern.find(text)?.value
    }

    fun extractAmount(text: String): String? {
        val patterns = listOf(
            Regex("""₹\s*(\d+\.?\d*)"""),
            Regex("""Rs\.?\s*(\d+\.?\d*)""", RegexOption.IGNORE_CASE),
            Regex("""(\d+\.?\d*)\s*₹"""),
            Regex("""earnings[:\s]+₹?\s*(\d+\.?\d*)""", RegexOption.IGNORE_CASE),
            Regex("""payout[:\s]+₹?\s*(\d+\.?\d*)""", RegexOption.IGNORE_CASE),
            Regex("""fare[:\s]+₹?\s*(\d+\.?\d*)""", RegexOption.IGNORE_CASE)
        )
        for (pattern in patterns) {
            val match = pattern.find(text)
            if (match != null) return match.value.trim()
        }
        return null
    }

    fun extractLocations(platform: DeliveryPlatform, lines: List<String>): Pair<String, String> =
        when (platform) {
            DeliveryPlatform.LOADSHARE -> extractLoadshareLocations(lines)
            DeliveryPlatform.ZOMATO    -> extractZomatoLocations(lines)
            DeliveryPlatform.SWIGGY    -> extractSwiggyLocations(lines)
            DeliveryPlatform.RAPIDO    -> extractRapidoLocations(lines)
            DeliveryPlatform.PORTER    -> extractPorterLocations(lines)
            DeliveryPlatform.DUNZO     -> extractDunzoLocations(lines)
            DeliveryPlatform.BLINKIT,
            DeliveryPlatform.ZEPTO,
            DeliveryPlatform.BIGBASKET -> extractQuickCommerceLocations(lines)
            else                       -> extractGenericLocations(lines)
        }

    // Loadshare order cards show bare locality names with no "Pickup:" / "Drop:" labels.
    // The first two non-amount, non-numeric, non-action lines are pickup and drop.
    fun extractLoadshareLocations(lines: List<String>): Pair<String, String> {
        val actionTexts = setOf(
            "choose order", "accept order", "accept", "view order", "decline",
            "skip", "new order", "order available", "order request",
            // Screen titles and app chrome — never location names
            "orders near you", "available orders", "nearby orders", "loadshare"
        )
        val candidates = lines.filter { line ->
            val l = line.trim()
            l.length in 4..50
                && !l.contains('₹')
                && !l.all { it.isDigit() || it == '.' || it == ' ' }
                && l.lowercase() !in actionTexts
        }
        val pickup = candidates.getOrNull(0) ?: "N/A"
        val drop   = candidates.getOrNull(1) ?: "N/A"
        return pickup to drop
    }

    // Zomato: Restaurant → pickup, Customer area → drop
    private fun extractZomatoLocations(lines: List<String>): Pair<String, String> {
        val pickup = extractAfterLabel(lines, listOf("pick up from", "pick up at", "restaurant", "outlet"))
            ?: extractGenericLocations(lines).first
        val drop = extractAfterLabel(lines, listOf("deliver to", "delivery at", "drop at", "customer"))
            ?: extractGenericLocations(lines).second
        return pickup to drop
    }

    // Swiggy: similar to Zomato but different label wording
    private fun extractSwiggyLocations(lines: List<String>): Pair<String, String> {
        val pickup = extractAfterLabel(lines, listOf("pick up", "pickup from", "store", "restaurant"))
            ?: extractGenericLocations(lines).first
        val drop = extractAfterLabel(lines, listOf("deliver to", "drop", "delivery location", "customer address"))
            ?: extractGenericLocations(lines).second
        return pickup to drop
    }

    // Rapido: ride pickup → drop
    private fun extractRapidoLocations(lines: List<String>): Pair<String, String> {
        val pickup = extractAfterLabel(lines, listOf("pickup", "pick up", "from", "start"))
            ?: extractGenericLocations(lines).first
        val drop = extractAfterLabel(lines, listOf("drop", "destination", "to", "end"))
            ?: extractGenericLocations(lines).second
        return pickup to drop
    }

    // Porter: goods transport pickup → drop
    private fun extractPorterLocations(lines: List<String>): Pair<String, String> {
        val pickup = extractAfterLabel(lines, listOf("pickup", "from", "collect from", "loading"))
            ?: extractGenericLocations(lines).first
        val drop = extractAfterLabel(lines, listOf("drop", "to", "deliver at", "unloading"))
            ?: extractGenericLocations(lines).second
        return pickup to drop
    }

    // Dunzo: store → customer
    private fun extractDunzoLocations(lines: List<String>): Pair<String, String> {
        val pickup = extractAfterLabel(lines, listOf("store", "pick up", "from", "merchant"))
            ?: extractGenericLocations(lines).first
        val drop = extractAfterLabel(lines, listOf("deliver at", "drop at", "customer", "to"))
            ?: extractGenericLocations(lines).second
        return pickup to drop
    }

    // Quick commerce (Blinkit/Zepto/BigBasket): dark store → customer
    private fun extractQuickCommerceLocations(lines: List<String>): Pair<String, String> {
        val pickup = extractAfterLabel(lines, listOf("store", "dark store", "warehouse", "pick up from"))
            ?: extractGenericLocations(lines).first
        val drop = extractAfterLabel(lines, listOf("deliver to", "drop at", "customer", "address"))
            ?: extractGenericLocations(lines).second
        return pickup to drop
    }

    // Generic fallback: works for Shadowfax, Delhivery and unknown apps
    fun extractGenericLocations(lines: List<String>): Pair<String, String> {
        val pickup = extractAfterLabel(lines, listOf("pickup", "pick up", "from", "collect", "origin"))
            ?: "N/A"
        val drop = extractAfterLabel(lines, listOf("drop", "deliver", "delivery", "to", "destination"))
            ?: "N/A"
        return pickup to drop
    }

    private fun extractAfterLabel(lines: List<String>, labels: List<String>): String? {
        for (i in lines.indices) {
            val line = lines[i].lowercase()
            if (labels.any { line.contains(it) }) {
                val nextLine = lines.getOrNull(i + 1)?.takeIf { it.isNotEmpty() && it.length > 2 }
                if (nextLine != null) return nextLine
                val inline = lines[i].substringAfter(":").trim()
                if (inline.length > 2) return inline
            }
        }
        return null
    }
}
