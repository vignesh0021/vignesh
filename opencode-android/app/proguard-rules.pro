# kotlinx.serialization
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class ai.opencode.mobile.**$$serializer { *; }
-keepclasseswithmembers class ai.opencode.mobile.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class ai.opencode.mobile.**$$serializer { *; }

# OkHttp / Okio
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.conscrypt.**

# Room generated code is kept by the Room consumer rules automatically.

# Keep Compose runtime metadata that R8 sometimes over-strips
-keepclassmembers class androidx.compose.** { *; }

# androidx.security-crypto pulls in Google Tink, which references errorprone /
# javax annotations that are compile-only and absent at runtime. Without these,
# R8 fails the release build on "Missing class" errors.
-dontwarn com.google.errorprone.annotations.**
-dontwarn javax.annotation.**
-dontwarn com.google.crypto.tink.**
