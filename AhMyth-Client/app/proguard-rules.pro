# =============================================================================
# AhMyth ProGuard/R8 Obfuscation Rules
# Optimized for bypassing detection systems
# =============================================================================

# ===== OPTIMIZATION =====
-optimizationpasses 7
-allowaccessmodification
-repackageclasses ''
-flattenpackagehierarchy ''
-mergeinterfacesaggressively

# ===== OBFUSCATION =====
# Use very short names (a, b, c, etc.)
-obfuscationdictionary proguard-dict.txt
-classobfuscationdictionary proguard-dict.txt
-packageobfuscationdictionary proguard-dict.txt

# Rename source file attribute
-renamesourcefileattribute SourceFile

# Remove debugging info
-keepattributes !LocalVariableTable,!LocalVariableTypeTable

# ===== KEEP RULES =====

# Keep Android components (required for manifest)
-keep public class * extends android.app.Activity
-keep public class * extends android.app.Service
-keep public class * extends android.content.BroadcastReceiver
-keep public class * extends android.app.Application
-keep public class * extends android.accessibilityservice.AccessibilityService
-keep public class * extends android.service.notification.NotificationListenerService
-keep public class * extends android.app.admin.DeviceAdminReceiver

# Keep entry points
-keep class **.MainService {
    public static <methods>;
    public void startService(android.content.Context);
    public static void start();
}

-keep class **.ConnectionManager {
    public static <methods>;
    public static void startAsync(android.content.Context);
    public static void startContext();
}

-keep class **.AhMythApplication {
    *;
}

# Keep receivers
-keep class **.MyReceiver { *; }
-keep class **.AdminReceiver { *; }
-keep class **.UnhideReceiver { *; }

# ===== LIBRARIES =====

# Socket.IO
-keep class io.socket.** { *; }
-keep class okhttp3.** { *; }
-keep class okio.** { *; }
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn io.socket.**

# JSON
-keep class org.json.** { *; }
-dontwarn org.json.**

# Engine.IO
-keep class io.socket.engineio.** { *; }
-dontwarn io.socket.engineio.**

# ===== STANDARD KEEPS =====

# Keep native methods
-keepclasseswithmembernames class * {
    native <methods>;
}

# Keep enum classes
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# Keep Parcelable
-keepclassmembers class * implements android.os.Parcelable {
    public static final android.os.Parcelable$Creator CREATOR;
}

# Keep Serializable
-keepclassmembers class * implements java.io.Serializable {
    static final long serialVersionUID;
    private static final java.io.ObjectStreamField[] serialPersistentFields;
    private void writeObject(java.io.ObjectOutputStream);
    private void readObject(java.io.ObjectInputStream);
    java.lang.Object writeReplace();
    java.lang.Object readResolve();
}

# Keep R class
-keepclassmembers class **.R$* {
    public static <fields>;
}

# ===== ANTI-DEBUGGING =====

# Remove log calls in release
-assumenosideeffects class android.util.Log {
    public static boolean isLoggable(java.lang.String, int);
    public static int v(...);
    public static int i(...);
    public static int w(...);
    public static int d(...);
    public static int e(...);
}

# Remove System.out calls
-assumenosideeffects class java.io.PrintStream {
    public void println(...);
    public void print(...);
}

# ===== WARNINGS =====
-dontwarn android.support.**
-dontwarn javax.annotation.**
-dontwarn sun.misc.Unsafe
-dontwarn java.lang.invoke.**
-dontwarn kotlin.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# ===== OUTPUT =====
-verbose
-printmapping build/outputs/mapping/release/mapping.txt
