package com.loadshare.areaalert.license

import java.security.KeyFactory
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.Base64

// Offline license verification. A license key is signed by the seller's private key
// (kept secret, used by tools/license/KeyGen.java) and verified here with the matching
// public key embedded below. Because verification is public-key based, the app binary
// contains no secret that could be used to forge keys.
//
// License key format:  base64url(payload) "." base64url(signature)
//   payload  = "<deviceId>|<expiryEpochDay>"   (UTF-8)
//   signature = SHA256withRSA over the payload bytes
object LicenseVerifier {

    // X.509 (SubjectPublicKeyInfo) RSA-2048 public key, Base64. Safe to ship — it can
    // only verify licenses, never mint them. Rotate by running `java KeyGen genkeys`
    // and replacing this string (invalidates all previously issued keys).
    private const val PUBLIC_KEY_B64 =
        "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3L+va2JgYiuydV0FlzOfILDRJw/+xwqkVQ2w4ZrK//zV2noT81WNVyd7FgDFdkDEI6Z0dhUVqXiCvqCW1UjBuEcD0rtYZ1hiA+zKT+w+gquA8T3QZ7+dAXn0EeuS+jm5GPt0hmAP+hGDHYuTf0kldym17CQmQDvSatS2QpQCMWE5szoQHJSrmt6KjT2/r3MfyoJgJq9yq0cA37NpIyvRUTC0ibzL6DLdj2IG7/5VFK70+B1oLfB8ja8Ui8yHCuFs0CddRUWhNB7mOjOwSOke3wlFYJfzxl14lWwOwN1GnwSYI6SEUMpeQ4OIkAePMR5yf1hXpKmrgT8VXurspLbOuQIDAQAB"

    data class LicenseInfo(val deviceId: String, val expiryEpochDay: Long)

    // Returns the decoded license info only if the signature is authentic and the
    // payload is well-formed. Returns null for any tampering, corruption, or bad format.
    // Does NOT check device match or expiry — the caller does that against live state.
    fun verify(licenseKey: String): LicenseInfo? {
        return try {
            val parts = licenseKey.trim().split(".")
            if (parts.size != 2) return null
            val payloadBytes = Base64.getUrlDecoder().decode(parts[0])
            val signatureBytes = Base64.getUrlDecoder().decode(parts[1])

            val publicKey = KeyFactory.getInstance("RSA")
                .generatePublic(X509EncodedKeySpec(Base64.getDecoder().decode(PUBLIC_KEY_B64)))
            val sig = Signature.getInstance("SHA256withRSA").apply {
                initVerify(publicKey)
                update(payloadBytes)
            }
            if (!sig.verify(signatureBytes)) return null

            val fields = String(payloadBytes, Charsets.UTF_8).split("|")
            if (fields.size != 2) return null
            val deviceId = fields[0]
            val expiry = fields[1].toLongOrNull() ?: return null
            if (deviceId.isBlank()) return null
            LicenseInfo(deviceId, expiry)
        } catch (_: Exception) {
            null
        }
    }
}
