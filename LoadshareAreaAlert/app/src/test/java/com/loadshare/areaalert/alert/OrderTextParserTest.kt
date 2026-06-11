package com.loadshare.areaalert.alert

import com.loadshare.areaalert.model.DeliveryPlatform
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class OrderTextParserTest {

    // ── Keyword matching on short lines ──────────────────────────────────

    @Test
    fun `keyword in short line is matched`() {
        val text = OrderTextParser.shortLineText("Choose Order\nNeelankarai\n₹87")
        assertEquals("Neelankarai", OrderTextParser.findMatchedKeyword(text, listOf("Neelankarai")))
    }

    @Test
    fun `keyword matching is case insensitive`() {
        val text = OrderTextParser.shortLineText("ecr main road\n₹55")
        assertEquals("ECR", OrderTextParser.findMatchedKeyword(text, listOf("ECR")))
    }

    @Test
    fun `keyword only inside long geocoded address line is NOT matched`() {
        val longLine = "No 4/22 Sea Breeze Apartments Phase 2 Neelankarai Chennai Tamil Nadu 600115 India"
        assertTrue(longLine.length > 60)
        val text = OrderTextParser.shortLineText("Choose Order\n$longLine\n₹87")
        assertNull(OrderTextParser.findMatchedKeyword(text, listOf("Neelankarai")))
    }

    @Test
    fun `excluded keyword suppresses order even when include keyword present`() {
        val text = OrderTextParser.shortLineText("ECR Road\nKarapakkam\n₹55")
        assertTrue(OrderTextParser.containsExcludedKeyword(text, listOf("Karapakkam")))
        // The caller (AlertManager) checks exclusion FIRST, so this order is skipped
    }

    @Test
    fun `no excluded keyword means order passes exclusion check`() {
        val text = OrderTextParser.shortLineText("ECR Road\nNeelankarai\n₹55")
        assertFalse(OrderTextParser.containsExcludedKeyword(text, listOf("Karapakkam", "OMR")))
    }

    @Test
    fun `empty excluded list never suppresses`() {
        val text = OrderTextParser.shortLineText("Karapakkam\n₹55")
        assertFalse(OrderTextParser.containsExcludedKeyword(text, emptyList()))
    }

    // ── Loadshare location extraction (the "N\/A" bug fix) ────────────────

    @Test
    fun `loadshare card text yields pickup and drop locality names`() {
        val lines = listOf("Choose Order", "Sholinganallur", "Karapakkam", "₹87", "2.3 km")
        val (pickup, drop) = OrderTextParser.extractLoadshareLocations(lines)
        assertEquals("Sholinganallur", pickup)
        assertEquals("Karapakkam", drop)
    }

    @Test
    fun `loadshare extraction skips amounts numbers and action buttons`() {
        val lines = listOf("Accept", "₹120", "55", "Neelankarai Beach Road", "ECR Injambakkam", "Decline")
        val (pickup, drop) = OrderTextParser.extractLoadshareLocations(lines)
        assertEquals("Neelankarai Beach Road", pickup)
        assertEquals("ECR Injambakkam", drop)
    }

    @Test
    fun `loadshare extraction skips screen titles like Orders Near You`() {
        val lines = listOf("Orders Near You", "Choose Order", "Sholinganallur", "Karapakkam", "₹87")
        val (pickup, drop) = OrderTextParser.extractLoadshareLocations(lines)
        assertEquals("Sholinganallur", pickup)
        assertEquals("Karapakkam", drop)
    }

    @Test
    fun `loadshare extraction returns NA when no locality lines exist`() {
        val lines = listOf("Accept", "₹120", "55")
        val (pickup, drop) = OrderTextParser.extractLoadshareLocations(lines)
        assertEquals("N/A", pickup)
        assertEquals("N/A", drop)
    }

    @Test
    fun `extractLocations routes LOADSHARE platform to loadshare extractor`() {
        val lines = listOf("Choose Order", "Sholinganallur", "Karapakkam", "₹87")
        val (pickup, drop) = OrderTextParser.extractLocations(DeliveryPlatform.LOADSHARE, lines)
        assertEquals("Sholinganallur", pickup)
        assertEquals("Karapakkam", drop)
    }

    @Test
    fun `generic extraction finds labelled pickup and drop`() {
        val lines = listOf("Pickup:", "Sholinganallur Store", "Drop:", "Neelankarai House")
        val (pickup, drop) = OrderTextParser.extractGenericLocations(lines)
        assertEquals("Sholinganallur Store", pickup)
        assertEquals("Neelankarai House", drop)
    }

    // ── Amount & distance parsing ─────────────────────────────────────────

    @Test
    fun `amount extracted from rupee symbol`() {
        assertEquals("₹87", OrderTextParser.extractAmount("Order pays ₹87 total"))
    }

    @Test
    fun `amount extracted from Rs prefix`() {
        assertEquals("Rs. 120", OrderTextParser.extractAmount("Earn Rs. 120 now"))
    }

    @Test
    fun `no amount returns null`() {
        assertNull(OrderTextParser.extractAmount("No money mentioned here"))
    }

    @Test
    fun `amount value parsed from string`() {
        assertEquals(87, OrderTextParser.parseAmountValue("₹87"))
        assertEquals(0, OrderTextParser.parseAmountValue("N/A"))
    }

    @Test
    fun `distance extracted with km unit`() {
        assertEquals("2.3 km", OrderTextParser.extractDistance("Distance: 2.3 km away"))
    }

    @Test
    fun `distance value parsed as double`() {
        assertEquals(2.3, OrderTextParser.parseDistanceValue("2.3 km"), 0.001)
        assertEquals(0.0, OrderTextParser.parseDistanceValue("N/A"), 0.001)
    }

    // ── Working hours ─────────────────────────────────────────────────────

    @Test
    fun `working hours disabled always passes`() {
        assertTrue(OrderTextParser.isWithinWorkingHours(enabled = false, startHour = 8, endHour = 21, currentHour = 3))
    }

    @Test
    fun `inside normal working hours passes`() {
        assertTrue(OrderTextParser.isWithinWorkingHours(enabled = true, startHour = 8, endHour = 21, currentHour = 12))
    }

    @Test
    fun `outside normal working hours fails`() {
        assertFalse(OrderTextParser.isWithinWorkingHours(enabled = true, startHour = 8, endHour = 21, currentHour = 22))
    }

    @Test
    fun `midnight-crossing schedule passes late night and early morning`() {
        // 22:00 – 06:00 shift
        assertTrue(OrderTextParser.isWithinWorkingHours(enabled = true, startHour = 22, endHour = 6, currentHour = 23))
        assertTrue(OrderTextParser.isWithinWorkingHours(enabled = true, startHour = 22, endHour = 6, currentHour = 3))
        assertFalse(OrderTextParser.isWithinWorkingHours(enabled = true, startHour = 22, endHour = 6, currentHour = 12))
    }

    // ── End-to-end: realistic Loadshare screen text ──────────────────────

    @Test
    fun `realistic loadshare list card matches preferred area and extracts details`() {
        val screenText = """
            Orders Near You
            Choose Order
            Neelankarai
            Injambakkam
            ₹87
            2.3 km
        """.trimIndent()

        val shortText = OrderTextParser.shortLineText(screenText)
        assertEquals("Neelankarai", OrderTextParser.findMatchedKeyword(shortText, listOf("Neelankarai", "ECR")))
        assertFalse(OrderTextParser.containsExcludedKeyword(shortText, listOf("Karapakkam", "OMR")))
        assertEquals("₹87", OrderTextParser.extractAmount(screenText))
        assertEquals("2.3 km", OrderTextParser.extractDistance(screenText))
    }

    @Test
    fun `realistic blocked-area card is excluded`() {
        val screenText = """
            Orders Near You
            Choose Order
            Karapakkam
            Thoraipakkam OMR
            ₹120
            1.1 km
        """.trimIndent()

        val shortText = OrderTextParser.shortLineText(screenText)
        assertTrue(OrderTextParser.containsExcludedKeyword(shortText, listOf("Karapakkam", "Thoraipakkam", "OMR")))
    }
}
