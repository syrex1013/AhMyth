package ahmyth.mine.king.ahmyth;

import android.util.Log;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.math.BigInteger;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

import org.bouncycastle.crypto.digests.KeccakDigest;
import org.bouncycastle.crypto.params.ECDomainParameters;
import org.bouncycastle.crypto.params.ECPrivateKeyParameters;
import org.bouncycastle.crypto.signers.ECDSASigner;
import org.bouncycastle.jce.ECNamedCurveTable;
import org.bouncycastle.jce.spec.ECParameterSpec;
import org.bouncycastle.math.ec.ECPoint;
import org.bouncycastle.math.ec.ECAlgorithms;

/**
 * BlockchainResponseSender - Sends encrypted responses to blockchain contract
 *
 * Architecture:
 * - Encrypts response data using shared AES key
 * - Signs raw transactions with secp256k1 (EIP-155) and submits via eth_sendRawTransaction
 * - Operator polls for Response events
 *
 * Note: Requires client wallet with ETH balance for gas fees
 */
public class BlockchainResponseSender {
    private static final String TAG = "BlockchainResponseSender";

    private String rpcUrl;
    private String contractAddress;
    private String aesKeyHex;
    private String privateKeyHex; // Client's wallet private key (for signing transactions)
    private final Object nonceLock = new Object();
    private BigInteger cachedNonce = null;

    public BlockchainResponseSender(String rpcUrl, String contractAddress, String aesKeyHex, String privateKeyHex) {
        this.rpcUrl = rpcUrl;
        this.contractAddress = contractAddress;
        this.aesKeyHex = aesKeyHex;
        this.privateKeyHex = privateKeyHex;
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
                    Log.d(TAG, "Sending response: " + eventName);

                    // Encrypt response
                    byte[] aesKeyBytes = hexStringToByteArray(aesKeyHex);
                    String encryptedHex = BlockchainCrypto.encrypt(responseJson, aesKeyBytes);

                    // Send transaction to contract.pushResponse()
                    sendRawTransaction(encryptedHex);

                } catch (Exception e) {
                    Log.e(TAG, "Failed to send response", e);
                }
            }
        }).start();
    }

    /**
     * Build and send signed raw transaction (EIP-155) for pushResponse(bytes).
     */
    private void sendRawTransaction(String encryptedHex) {
        try {
            String from = getAddressFromPrivateKey(privateKeyHex);

            BigInteger nonce = getNextNonce(from);
            BigInteger gasPrice = getGasPrice();
            if (gasPrice == null) gasPrice = new BigInteger("20000000000"); // 20 gwei fallback
            // Add a small bump to reduce underpriced replacements
            gasPrice = gasPrice.add(new BigInteger("2000000000")); // +2 gwei
            BigInteger gasLimit = new BigInteger("5000000"); // allow larger payloads

            String data = buildPushResponseData(encryptedHex);

            byte[] rawTx = signTransaction(
                    nonce,
                    gasPrice,
                    gasLimit,
                    contractAddress,
                    BigInteger.ZERO,
                    data,
                    11155111L // Sepolia
            );

            JSONObject req = new JSONObject();
            req.put("jsonrpc", "2.0");
            req.put("id", 1);
            req.put("method", "eth_sendRawTransaction");
            JSONArray params = new JSONArray();
            params.put("0x" + bytesToHex(rawTx));
            req.put("params", params);

            String resp = sendRpcRequest(req.toString());
            Log.d(TAG, "Transaction response: " + resp);

            JSONObject respJson = new JSONObject(resp);
            if (respJson.has("error")) {
                Log.e(TAG, "Transaction failed: " + respJson.getJSONObject("error").toString());
            } else if (respJson.has("result")) {
                Log.d(TAG, "Response sent! Tx hash: " + respJson.getString("result"));
            }

        } catch (Exception e) {
            Log.e(TAG, "Error sending raw transaction", e);
        }
    }

    private String buildPushResponseData(String encryptedHex) {
        String selector = "5eb57f57"; // keccak256("pushResponse(bytes)") first 4 bytes
        String encoded = encodeBytes(encryptedHex);
        return "0x" + selector + encoded;
    }

    /**
     * Encode bytes for ABI encoding
     */
    private String encodeBytes(String hexData) {
        if (hexData.startsWith("0x")) {
            hexData = hexData.substring(2);
        }
        int dataLength = hexData.length() / 2;
        String offset = padHex("20", 64); // offset 0x20
        String length = padHex(Integer.toHexString(dataLength), 64);
        int paddingBytes = (32 - (dataLength % 32)) % 32;
        StringBuilder paddedData = new StringBuilder(hexData);
        for (int i = 0; i < paddingBytes * 2; i++) {
            paddedData.append("0");
        }
        return offset + length + paddedData;
    }

    private String padHex(String hex, int length) {
        StringBuilder sb = new StringBuilder(hex);
        while (sb.length() < length) {
            sb.insert(0, '0');
        }
        return sb.toString();
    }

    private BigInteger getNonce(String address) {
        try {
            JSONObject req = new JSONObject();
            req.put("jsonrpc", "2.0");
            req.put("id", 1);
            req.put("method", "eth_getTransactionCount");
            JSONArray params = new JSONArray();
            params.put(address);
            // Use pending to account for in-flight transactions
            params.put("pending");
            req.put("params", params);
            String resp = sendRpcRequest(req.toString());
            JSONObject json = new JSONObject(resp);
            String result = json.optString("result", "0x0");
            return new BigInteger(result.substring(2), 16);
        } catch (Exception e) {
            Log.e(TAG, "Failed to fetch nonce", e);
            return BigInteger.ZERO;
        }
    }

    /**
     * Get the next nonce, keeping a local counter to avoid collisions
     * when multiple responses are sent quickly.
     */
    private BigInteger getNextNonce(String address) {
        synchronized (nonceLock) {
            BigInteger networkNonce = getNonce(address);
            if (cachedNonce == null || networkNonce.compareTo(cachedNonce) > 0) {
                cachedNonce = networkNonce;
            }
            BigInteger useNonce = cachedNonce;
            cachedNonce = cachedNonce.add(BigInteger.ONE);
            return useNonce;
        }
    }

    private BigInteger getGasPrice() {
        try {
            JSONObject req = new JSONObject();
            req.put("jsonrpc", "2.0");
            req.put("id", 1);
            req.put("method", "eth_gasPrice");
            req.put("params", new JSONArray());
            String resp = sendRpcRequest(req.toString());
            JSONObject json = new JSONObject(resp);
            String result = json.optString("result", "0x0");
            return new BigInteger(result.substring(2), 16);
        } catch (Exception e) {
            Log.e(TAG, "Failed to fetch gas price", e);
            return null;
        }
    }

    /**
     * Get address from private key (secp256k1)
     */
    private String getAddressFromPrivateKey(String privKeyHex) throws Exception {
        if (privKeyHex.startsWith("0x")) {
            privKeyHex = privKeyHex.substring(2);
        }
        BigInteger privKey = new BigInteger(privKeyHex, 16);
        ECParameterSpec ecSpec = ECNamedCurveTable.getParameterSpec("secp256k1");
        ECPoint Q = ecSpec.getG().multiply(privKey).normalize();
        byte[] pubBytes = Q.getEncoded(false);
        byte[] hash = keccak256(stripPrefix(pubBytes));
        byte[] address = new byte[20];
        System.arraycopy(hash, 12, address, 0, 20);
        return "0x" + bytesToHex(address);
    }

    private byte[] stripPrefix(byte[] pub) {
        if (pub.length == 65 && pub[0] == 0x04) {
            byte[] out = new byte[64];
            System.arraycopy(pub, 1, out, 0, 64);
            return out;
        }
        return pub;
    }

    /**
     * Sign transaction with EIP-155 (chainId) and return raw RLP bytes.
     */
    private byte[] signTransaction(BigInteger nonce, BigInteger gasPrice, BigInteger gasLimit,
                                   String to, BigInteger value, String dataHex, long chainId) throws Exception {
        if (to.startsWith("0x")) {
            to = to.substring(2);
        }
        if (dataHex.startsWith("0x")) {
            dataHex = dataHex.substring(2);
        }

        byte[] toBytes = hexStringToByteArray(to);
        byte[] dataBytes = hexStringToByteArray(dataHex);

        RlpList sigData = new RlpList(
                RlpString.create(nonce),
                RlpString.create(gasPrice),
                RlpString.create(gasLimit),
                RlpString.create(toBytes),
                RlpString.create(value),
                RlpString.create(dataBytes),
                RlpString.create(BigInteger.valueOf(chainId)),
                RlpString.create(BigInteger.ZERO),
                RlpString.create(BigInteger.ZERO)
        );

        byte[] encodedForSig = RlpEncoder.encode(sigData);
        byte[] hash = keccak256(encodedForSig);

        BigInteger privKey = new BigInteger(privateKeyHex.replace("0x", ""), 16);
        ECParameterSpec ecSpec = ECNamedCurveTable.getParameterSpec("secp256k1");
        ECDomainParameters domain = new ECDomainParameters(ecSpec.getCurve(), ecSpec.getG(), ecSpec.getN(), ecSpec.getH());
        ECPrivateKeyParameters privKeyParams = new ECPrivateKeyParameters(privKey, domain);
        ECDSASigner signer = new ECDSASigner();
        signer.init(true, privKeyParams);
        BigInteger[] sig = signer.generateSignature(hash);
        BigInteger r = sig[0];
        BigInteger s = sig[1];

        BigInteger halfCurve = ecSpec.getN().shiftRight(1);
        if (s.compareTo(halfCurve) > 0) {
            s = ecSpec.getN().subtract(s);
        }

        int recId = calcRecId(hash, r, s, privKey, ecSpec);
        long v = recId + 35 + chainId * 2;

        RlpList signedData = new RlpList(
                RlpString.create(nonce),
                RlpString.create(gasPrice),
                RlpString.create(gasLimit),
                RlpString.create(toBytes),
                RlpString.create(value),
                RlpString.create(dataBytes),
                RlpString.create(BigInteger.valueOf(v)),
                RlpString.create(r),
                RlpString.create(s)
        );
        return RlpEncoder.encode(signedData);
    }

    private int calcRecId(byte[] hash, BigInteger r, BigInteger s, BigInteger privKey, ECParameterSpec ecSpec) {
        try {
            ECPoint q = ecSpec.getG().multiply(privKey).normalize();
            for (int i = 0; i < 4; i++) {
                ECPoint k = recoverFromSignature(i, r, s, hash, ecSpec);
                if (k != null && k.equals(q)) {
                    return i;
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to calc recId", e);
        }
        return 0;
    }

    private ECPoint recoverFromSignature(int recId, BigInteger r, BigInteger s, byte[] hash, ECParameterSpec ecSpec) {
        BigInteger n = ecSpec.getN();
        BigInteger i = BigInteger.valueOf((long) recId / 2);
        BigInteger x = r.add(i.multiply(n));
        ECPoint R = decompressKey(x, (recId & 1) == 1, ecSpec);
        if (!R.multiply(n).isInfinity()) {
            return null;
        }
        BigInteger e = new BigInteger(1, hash);
        BigInteger rInv = r.modInverse(n);
        BigInteger srInv = s.multiply(rInv).mod(n);
        BigInteger eInv = n.subtract(e).multiply(rInv).mod(n);
        ECPoint q = ECAlgorithms.sumOfTwoMultiplies(ecSpec.getG(), eInv, R, srInv).normalize();
        return q;
    }

    private ECPoint decompressKey(BigInteger xBN, boolean yBit, ECParameterSpec ecSpec) {
        String prefix = yBit ? "03" : "02";
        byte[] enc = hexStringToByteArray(prefix + leftPadHex(xBN.toString(16), 64));
        return ecSpec.getCurve().decodePoint(enc);
    }

    private byte[] keccak256(byte[] input) {
        KeccakDigest digest = new KeccakDigest(256);
        digest.update(input, 0, input.length);
        byte[] out = new byte[32];
        digest.doFinal(out, 0);
        return out;
    }

    /**
     * Send JSON-RPC request
     */
    private String sendRpcRequest(String requestBody) throws Exception {
        URL url = new URL(rpcUrl);
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
                return response.toString();
            }
        } else {
            throw new Exception("HTTP " + responseCode);
        }
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

    private String leftPadHex(String hex, int length) {
        StringBuilder sb = new StringBuilder(hex);
        while (sb.length() < length) {
            sb.insert(0, '0');
        }
        return sb.toString();
    }

    // === Minimal RLP helpers ===
    private interface RlpType {}

    private static class RlpString implements RlpType {
        private final byte[] value;
        private RlpString(byte[] value) { this.value = value; }
        static RlpString create(BigInteger value) { return new RlpString(asUnsigned(value)); }
        static RlpString create(byte[] value) { return new RlpString(value == null ? new byte[]{} : value); }
    }

    private static class RlpList implements RlpType {
        private final RlpType[] values;
        RlpList(RlpType... values) { this.values = values; }
    }

    private static class RlpEncoder {
        static byte[] encode(RlpType value) {
            if (value instanceof RlpString) {
                return encodeString(((RlpString) value).value);
            } else if (value instanceof RlpList) {
                byte[][] encoded = new byte[((RlpList) value).values.length][];
                int totalLength = 0;
                for (int i = 0; i < ((RlpList) value).values.length; i++) {
                    encoded[i] = encode(((RlpList) value).values[i]);
                    totalLength += encoded[i].length;
                }
                byte[] length = encodeLength(totalLength, 0xc0);
                ByteBuffer buffer = ByteBuffer.allocate(length.length + totalLength);
                buffer.put(length);
                for (byte[] e : encoded) buffer.put(e);
                return buffer.array();
            }
            return new byte[]{};
        }

        private static byte[] encodeString(byte[] srcData) {
            if (srcData.length == 1 && (srcData[0] & 0xFF) < 0x80) {
                return srcData;
            } else {
                byte[] lenBytes = encodeLength(srcData.length, 0x80);
                ByteBuffer buffer = ByteBuffer.allocate(lenBytes.length + srcData.length);
                buffer.put(lenBytes);
                buffer.put(srcData);
                return buffer.array();
            }
        }

        private static byte[] encodeLength(int length, int offset) {
            if (length < 56) {
                return new byte[]{(byte) (length + offset)};
            } else {
                byte[] lenBytes = toMinimalByteArray(length);
                ByteBuffer buffer = ByteBuffer.allocate(1 + lenBytes.length);
                buffer.put((byte) (lenBytes.length + offset + 55));
                buffer.put(lenBytes);
                return buffer.array();
            }
        }

        private static byte[] toMinimalByteArray(int value) {
            return BigInteger.valueOf(value).toByteArray()[0] == 0
                    ? trimLeadingZero(BigInteger.valueOf(value).toByteArray())
                    : BigInteger.valueOf(value).toByteArray();
        }
    }

    private static byte[] asUnsigned(BigInteger value) {
        byte[] data = value.toByteArray();
        if (data.length > 0 && data[0] == 0) {
            byte[] tmp = new byte[data.length - 1];
            System.arraycopy(data, 1, tmp, 0, tmp.length);
            return tmp;
        }
        return data;
    }

    private static byte[] trimLeadingZero(byte[] data) {
        int start = 0;
        while (start < data.length - 1 && data[start] == 0) start++;
        byte[] out = new byte[data.length - start];
        System.arraycopy(data, start, out, 0, out.length);
        return out;
    }
}
