package ahmyth.mine.king.ahmyth;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.util.Log;

/**
 * AppInstallReceiver - Receives package installation status updates
 */
public class AppInstallReceiver extends BroadcastReceiver {
    private static final String TAG = "AppInstallReceiver";
    
    @Override
    public void onReceive(Context context, Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        String packageName = intent.getStringExtra(PackageInstaller.EXTRA_PACKAGE_NAME);
        String message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        
        switch (status) {
            case PackageInstaller.STATUS_SUCCESS:
                Log.d(TAG, "Package installed successfully: " + packageName);
                break;
            case PackageInstaller.STATUS_FAILURE:
                Log.e(TAG, "Package installation failed: " + packageName + " - " + message);
                break;
            case PackageInstaller.STATUS_FAILURE_ABORTED:
                Log.e(TAG, "Package installation aborted: " + packageName);
                break;
            case PackageInstaller.STATUS_FAILURE_BLOCKED:
                Log.e(TAG, "Package installation blocked: " + packageName);
                break;
            case PackageInstaller.STATUS_FAILURE_CONFLICT:
                Log.e(TAG, "Package installation conflict: " + packageName);
                break;
            case PackageInstaller.STATUS_FAILURE_INCOMPATIBLE:
                Log.e(TAG, "Package installation incompatible: " + packageName);
                break;
            case PackageInstaller.STATUS_FAILURE_INVALID:
                Log.e(TAG, "Package installation invalid: " + packageName);
                break;
            case PackageInstaller.STATUS_FAILURE_STORAGE:
                Log.e(TAG, "Package installation storage error: " + packageName);
                break;
            default:
                Log.w(TAG, "Unknown installation status: " + status + " for " + packageName);
                break;
        }
    }
}

