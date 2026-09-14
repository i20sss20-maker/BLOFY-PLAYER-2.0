# Staged name obfuscation only. Not a claim of encryption or complete security.
# Keep shrinking/optimization off until minified runtime compatibility is accepted.
-dontshrink
-dontoptimize
-keepattributes Signature,InnerClasses,EnclosingMethod,*Annotation*

# Intentionally broad during staging: third-party and playback code remain intact.
# This means ALL classes outside the app namespace are kept, not just dependencies we call.
-keep class !tv.blofy.player.** { *; }
-keep class tv.blofy.player.core.playback.** { *; }
-keep class tv.blofy.player.ui.player.** { *; }

# Current unannotated Gson DTOs and local caches use these field names as contracts.
-keepclassmembers class tv.blofy.player.** { <fields>; }
-keep class * extends androidx.work.ListenableWorker { *; }
-keep class * extends androidx.room.RoomDatabase { *; }
-keep class **_Impl { *; }
-keep class * extends android.app.Application { *; }
-keep class * extends android.app.Activity { *; }
-keep class * extends android.view.View {
    public <init>(...);
    public void set*(...);
    public *** get*();
}
-keepclasseswithmembernames,includedescriptorclasses class * { native <methods>; }
-keepnames class * implements java.io.Serializable
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
    public static <fields>;
}
# Do not suppress all warnings or upload mapping.txt in public artifacts.
