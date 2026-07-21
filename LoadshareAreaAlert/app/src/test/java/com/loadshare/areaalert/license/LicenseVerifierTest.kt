package com.loadshare.areaalert.license

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LicenseVerifierTest {

    // A real license signed by the seller private key for device "unittest-device"
    // with a ~100-year expiry (epochDay 57179). Generated with tools/license/KeyGen.
    private val validKey =
        "dW5pdHRlc3QtZGV2aWNlfDU3MTc5.Gvw3v7JGQanrR2uKvWRM9WyDbYuxPGLR_ObLZzUCrvBfffqOm9MMkg9HrLeI2Koo0BfSCV-q86LHtGr_VWA2yu02N7sDNAouzoGOj6OMqsiOP9CP5wPEtOBXTVmrI1aU7gVuoRz_VeQBdQtUYXPmypeH1JnQ-Lysb7-KIxF37R_XTbmWW4pwDWq4i1hSH-YNzWe-CEuS659AQKqtBSa-394hHTcFir7Guj0yHsqs49P_K9ANFElO2bR-uk0MvM1qfNILmeg83VDAjihtaZjBNIrDPnvNhM7dWstHXV7b_JlWtxqX1NBS-38iMKrtqAKJm7a9IVt_7z-Mmtse8mO4sg"

    @Test
    fun `valid key decodes device and expiry`() {
        val info = LicenseVerifier.verify(validKey)
        assertEquals("unittest-device", info?.deviceId)
        assertEquals(57179L, info?.expiryEpochDay)
    }

    @Test
    fun `whitespace around key is tolerated`() {
        val info = LicenseVerifier.verify("  \n$validKey\n ")
        assertEquals("unittest-device", info?.deviceId)
    }

    @Test
    fun `tampered signature is rejected`() {
        // Flip the last two chars of the signature portion
        val tampered = validKey.dropLast(2) + "AA"
        assertNull(LicenseVerifier.verify(tampered))
    }

    @Test
    fun `tampered payload is rejected`() {
        // Re-encode a different device into the payload; signature no longer matches
        val sig = validKey.substringAfter(".")
        val forgedPayload = java.util.Base64.getUrlEncoder().withoutPadding()
            .encodeToString("hacker-device|999999".toByteArray())
        assertNull(LicenseVerifier.verify("$forgedPayload.$sig"))
    }

    @Test
    fun `garbage input returns null`() {
        assertNull(LicenseVerifier.verify(""))
        assertNull(LicenseVerifier.verify("not-a-key"))
        assertNull(LicenseVerifier.verify("only.onedot"))
        assertNull(LicenseVerifier.verify("a.b.c"))
    }
}
