package ahmyth.mine.king.ahmyth;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;

/**
 * Transparent activity to request screen capture permission
 * This is needed because MediaProjection requires an Activity result
 */
public class ScreenCaptureActivity extends Activity {
    private static final String TAG = "ScreenCaptureActivity";
    private static final int REQUEST_CODE = 1007;
    
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Log.d(TAG, "ScreenCaptureActivity created");
        
        // Request screen capture permission immediately
        requestScreenCapture();
    }
    
    private void requestScreenCapture() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            try {
                MediaProjectionManager projectionManager = 
                    (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
                
                if (projectionManager != null) {
                    Intent captureIntent = projectionManager.createScreenCaptureIntent();
                    startActivityForResult(captureIntent, REQUEST_CODE);
                    Log.d(TAG, "Screen capture permission dialog shown");
                } else {
                    Log.e(TAG, "MediaProjectionManager is null");
                    finish();
                }
            } catch (Exception e) {
                Log.e(TAG, "Error requesting screen capture", e);
                finish();
            }
        } else {
            Log.w(TAG, "Screen capture not supported on this Android version");
            finish();
        }
    }
    
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        
        if (requestCode == REQUEST_CODE) {
            Log.d(TAG, "Screen capture result: " + resultCode);
            
            if (resultCode == RESULT_OK && data != null) {
                // Store permission for ScreenStreamService
                ScreenStreamService.setProjectionPermission(resultCode, data);
                
                // Start the screen stream service
                Intent serviceIntent = new Intent(this, ScreenStreamService.class);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    startForegroundService(serviceIntent);
                } else {
                    startService(serviceIntent);
                }
                Log.d(TAG, "Screen capture service started successfully");
            } else {
                Log.w(TAG, "Screen capture permission denied by user");
            }
        }
        
        // Close this activity
        finish();
    }
    
    @Override
    public void finish() {
        super.finish();
        // No animation when closing
        overridePendingTransition(0, 0);
    }
}

