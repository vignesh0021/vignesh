# Kotlinx serialization
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-keepclassmembers class kotlinx.serialization.json.** { *** Companion; }
-keepclasseswithmembers class kotlinx.serialization.json.** { kotlinx.serialization.KSerializer serializer(...); }
-keep,includedescriptorclasses class com.floorplan3d.**$$serializer { *; }
-keepclassmembers class com.floorplan3d.** { *** Companion; }
-keepclasseswithmembers class com.floorplan3d.** { kotlinx.serialization.KSerializer serializer(...); }

# ML Kit
-keep class com.google.mlkit.** { *; }
-dontwarn com.google.mlkit.**
