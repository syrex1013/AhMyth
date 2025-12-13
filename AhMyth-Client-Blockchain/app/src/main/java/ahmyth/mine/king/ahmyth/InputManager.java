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
            if (key == null || key.trim().isEmpty()) {
                result.put("success", false);
                result.put("error", "Key cannot be null or empty");
                result.put("key", key);
                result.put("action", "keyPress");
                return result;
            }
            
            // Normalize key: trim whitespace and convert to lowercase
            String normalizedKey = key.trim().toLowerCase();
            Log.d(TAG, "Key press: '" + key + "' (normalized: '" + normalizedKey + "')");
            
            int keyCode;
            switch (normalizedKey) {
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
                case "volume_up":
                case "volume-up":
                    keyCode = 24;
                    break;
                case "volumedown":
                case "volume_down":
                case "volume-down":
                    keyCode = 25;
                    break;
                case "enter":
                    keyCode = 66;
                    break;
                default:
                    // Try to parse as integer keycode
                    try {
                        keyCode = Integer.parseInt(normalizedKey);
                    } catch (NumberFormatException e) {
                        result.put("success", false);
                        result.put("error", "Invalid key: '" + key + "'. Valid keys: back, home, recents, power, volumeup, volumedown, enter, or a numeric keycode");
                        result.put("key", key);
                        result.put("action", "keyPress");
                        return result;
                    }
            }
            
            boolean success = performShellKey(keyCode);
            
            result.put("success", success);
            result.put("key", key);
            result.put("keyCode", keyCode);
            result.put("action", "keyPress");
            
            // If failed, provide a helpful error message
            if (!success) {
                String errorMsg = "Key injection failed. ";
                if (keyCode == 24 || keyCode == 25) {
                    errorMsg += "Volume keys may require app to be in foreground or accessibility service enabled.";
                } else if (keyCode == 66) {
                    errorMsg += "Enter key may require app to be in foreground.";
                } else if (keyCode == 3 || keyCode == 4 || keyCode == 187) {
                    errorMsg += "Navigation keys may require root access or accessibility service.";
                } else {
                    errorMsg += "Key may require root access or accessibility service.";
                }
                result.put("error", errorMsg);
            }
            
        } catch (Exception e) {
            Log.e(TAG, "Error performing key press", e);
            try {
                result.put("success", false);
                result.put("error", e.getMessage() != null ? e.getMessage() : "Unknown error");
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
        // Try multiple methods for key injection
        boolean success = false;
        String lastError = null;
        
        // Method 1: For volume keys, try using AudioManager first (most reliable)
        if (keyCode == 24 || keyCode == 25) { // Volume up/down
            try {
                success = performVolumeKey(keyCode);
                if (success) {
                    Log.d(TAG, "Volume key sent successfully via AudioManager");
                    return true;
                }
            } catch (Exception e) {
                lastError = "AudioManager: " + e.getMessage();
                Log.d(TAG, lastError);
            }
        }
        
        // Method 2: Try using cmd input (Android 7+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            try {
                success = executeShellCommand("cmd input keyevent " + keyCode);
                if (success) {
                    Log.d(TAG, "Key event sent successfully via cmd input");
                    return true;
                }
            } catch (Exception e) {
                lastError = "cmd input: " + e.getMessage();
                Log.d(TAG, lastError);
            }
        }
        
        // Method 3: Try using sh -c for better shell execution
        try {
            success = executeShellCommandWithSh("input keyevent " + keyCode);
            if (success) {
                Log.d(TAG, "Key event sent successfully via sh -c");
                return true;
            }
        } catch (Exception e) {
            lastError = "sh -c: " + e.getMessage();
            Log.d(TAG, lastError);
        }
        
        // Method 4: Try direct input command
        try {
            success = executeShellCommand("input keyevent " + keyCode);
            if (success) {
                Log.d(TAG, "Key event sent successfully via direct input");
                return true;
            }
        } catch (Exception e) {
            lastError = "direct input: " + e.getMessage();
            Log.d(TAG, lastError);
        }
        
        // Method 5: Try with full path
        try {
            success = executeShellCommand("/system/bin/input keyevent " + keyCode);
            if (success) {
                Log.d(TAG, "Key event sent successfully via /system/bin/input");
                return true;
            }
        } catch (Exception e) {
            lastError = "/system/bin/input: " + e.getMessage();
            Log.d(TAG, lastError);
        }
        
        // Method 6: Try using Instrumentation API (requires app context and foreground)
        if (context != null) {
            try {
                success = performInstrumentationKey(keyCode);
                if (success) {
                    Log.d(TAG, "Key event sent successfully via Instrumentation");
                    return true;
                }
            } catch (Exception e) {
                lastError = "Instrumentation: " + e.getMessage();
                Log.d(TAG, lastError);
            }
        }
        
        // Method 7: For Enter key, try alternative key codes
        if (keyCode == 66) { // Enter key
            try {
                // Try DPAD_CENTER (23) as alternative
                success = executeShellCommand("input keyevent 23");
                if (success) {
                    Log.d(TAG, "Enter key sent successfully via DPAD_CENTER");
                    return true;
                }
            } catch (Exception e) {
                lastError = "DPAD_CENTER: " + e.getMessage();
                Log.d(TAG, lastError);
            }
        }
        
        // Method 8: Try using service call for system keys (Android 5+)
        if (keyCode == 3 || keyCode == 4 || keyCode == 187) { // Home, Back, Recents
            try {
                success = performServiceCallKey(keyCode);
                if (success) {
                    Log.d(TAG, "Key event sent successfully via service call");
                    return true;
                }
            } catch (Exception e) {
                lastError = "service call: " + e.getMessage();
                Log.d(TAG, lastError);
            }
        }
        
        Log.w(TAG, "All key injection methods failed for keyCode: " + keyCode + (lastError != null ? " (Last error: " + lastError + ")" : ""));
        return false;
    }
    
    /**
     * Use service call for system navigation keys (requires root or system app)
     */
    private boolean performServiceCallKey(int keyCode) {
        try {
            // This method uses service call which may require root
            // For Home: service call activity 42 s16 com.android.systemui
            // For Back: service call activity 42 s16 com.android.systemui
            // For Recents: service call activity 42 s16 com.android.systemui
            
            // Alternative: Use am broadcast for some keys
            if (keyCode == 3) { // Home
                return executeShellCommand("am start -a android.intent.action.MAIN -c android.intent.category.HOME");
            } else if (keyCode == 4) { // Back
                // Back is harder - try using input keyevent with su if available
                return executeShellCommand("input keyevent 4");
            } else if (keyCode == 187) { // Recents
                // Try to open recent apps
                return executeShellCommand("am start -a android.intent.action.MAIN -c android.intent.category.HOME");
            }
            return false;
        } catch (Exception e) {
            Log.e(TAG, "Error using service call for key", e);
            return false;
        }
    }
    
    /**
     * Use AudioManager for volume control (more reliable than shell commands)
     */
    private boolean performVolumeKey(int keyCode) {
        try {
            android.media.AudioManager audioManager = (android.media.AudioManager) 
                context.getSystemService(Context.AUDIO_SERVICE);
            if (audioManager == null) {
                Log.w(TAG, "AudioManager service not available");
                return false;
            }
            
            int direction;
            if (keyCode == 24) { // Volume up
                direction = android.media.AudioManager.ADJUST_RAISE;
            } else if (keyCode == 25) { // Volume down
                direction = android.media.AudioManager.ADJUST_LOWER;
            } else {
                Log.w(TAG, "Invalid keyCode for volume: " + keyCode);
                return false;
            }
            
            // Adjust volume with FLAG_SHOW_UI to show volume indicator
            // This works without root and doesn't require special permissions
            audioManager.adjustStreamVolume(
                android.media.AudioManager.STREAM_MUSIC,
                direction,
                android.media.AudioManager.FLAG_SHOW_UI
            );
            
            Log.d(TAG, "Volume adjusted successfully via AudioManager (keyCode: " + keyCode + ")");
            return true;
        } catch (SecurityException e) {
            Log.e(TAG, "SecurityException using AudioManager for volume - may need MODIFY_AUDIO_SETTINGS permission", e);
            return false;
        } catch (Exception e) {
            Log.e(TAG, "Error using AudioManager for volume", e);
            return false;
        }
    }
    
    /**
     * Use Instrumentation API for key injection (requires app to be in foreground)
     */
    private boolean performInstrumentationKey(int keyCode) {
        try {
            // This requires the app to have focus, but it's more reliable
            android.app.Instrumentation instrumentation = new android.app.Instrumentation();
            instrumentation.sendKeyDownUpSync(keyCode);
            return true;
        } catch (Exception e) {
            Log.d(TAG, "Instrumentation key injection failed (app may not be in foreground): " + e.getMessage());
            return false;
        }
    }
    
    private boolean executeShellCommand(String command) {
        try {
            // Execute command directly
            Process process = Runtime.getRuntime().exec(command);
            
            // Read output to check for errors
            java.io.BufferedReader reader = new java.io.BufferedReader(
                new java.io.InputStreamReader(process.getInputStream()));
            java.io.BufferedReader errorReader = new java.io.BufferedReader(
                new java.io.InputStreamReader(process.getErrorStream()));
            
            StringBuilder output = new StringBuilder();
            StringBuilder errorOutput = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                output.append(line).append("\n");
            }
            while ((line = errorReader.readLine()) != null) {
                errorOutput.append(line).append("\n");
            }
            
            int exitCode = process.waitFor();
            
            if (exitCode == 0) {
                return true;
            } else {
                String errorMsg = errorOutput.length() > 0 ? errorOutput.toString().trim() : 
                                 (output.length() > 0 ? output.toString().trim() : "Unknown error");
                
                // Check for specific error messages
                if (errorMsg.toLowerCase().contains("invalid") || 
                    errorMsg.toLowerCase().contains("permission denied") ||
                    errorMsg.toLowerCase().contains("not allowed")) {
                    Log.w(TAG, "Shell command failed: " + errorMsg + " (Command: " + command + ")");
                } else {
                    Log.w(TAG, "Shell command failed with exit code " + exitCode + ": " + command);
                    if (errorMsg.length() > 0 && !errorMsg.equals("Unknown error")) {
                        Log.w(TAG, "Command error: " + errorMsg);
                    }
                }
                return false;
            }
        } catch (Exception e) {
            Log.e(TAG, "Shell command exception: " + command, e);
            return false;
        }
    }
    
    private boolean executeShellCommandWithSh(String command) {
        try {
            // Use ProcessBuilder with sh -c for better shell execution
            ProcessBuilder processBuilder = new ProcessBuilder("sh", "-c", command);
            processBuilder.redirectErrorStream(true);
            Process process = processBuilder.start();
            
            // Read output to check for errors
            java.io.BufferedReader reader = new java.io.BufferedReader(
                new java.io.InputStreamReader(process.getInputStream()));
            StringBuilder output = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                output.append(line).append("\n");
            }
            
            int exitCode = process.waitFor();
            
            if (exitCode == 0) {
                return true;
            } else {
                String errorMsg = output.length() > 0 ? output.toString().trim() : "Unknown error";
                
                // Check for specific error messages that indicate invalid input
                if (errorMsg.toLowerCase().contains("invalid") || 
                    errorMsg.toLowerCase().contains("permission denied") ||
                    errorMsg.toLowerCase().contains("not allowed") ||
                    errorMsg.toLowerCase().contains("input: invalid")) {
                    Log.w(TAG, "Shell command (sh -c) failed: " + errorMsg + " (Command: " + command + ")");
                } else {
                    Log.w(TAG, "Shell command (sh -c) failed with exit code " + exitCode + ": " + command);
                    if (errorMsg.length() > 0 && !errorMsg.equals("Unknown error")) {
                        Log.w(TAG, "Command output: " + errorMsg);
                    }
                }
                return false;
            }
        } catch (Exception e) {
            Log.e(TAG, "Shell command (sh -c) exception: " + command, e);
            return false;
        }
    }
}

