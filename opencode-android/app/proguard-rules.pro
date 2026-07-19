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
