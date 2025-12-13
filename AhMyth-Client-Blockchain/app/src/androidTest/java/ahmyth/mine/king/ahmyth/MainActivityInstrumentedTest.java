package ahmyth.mine.king.ahmyth;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;

import android.support.test.InstrumentationRegistry;
import android.support.test.rule.ActivityTestRule;
import android.support.test.runner.AndroidJUnit4;

import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.runner.RunWith;

import static org.junit.Assert.*;

/**
 * Instrumented test for MainActivity
 * Runs on an Android device or emulator
 */
@RunWith(AndroidJUnit4.class)
public class MainActivityInstrumentedTest {

    @Rule
    public ActivityTestRule<MainActivity> activityRule = 
        new ActivityTestRule<>(MainActivity.class, false, false);

    private Context context;

    @Before
    public void setUp() {
        context = InstrumentationRegistry.getTargetContext();
    }

    @Test
    public void useAppContext() {
        // Test that we're using the correct application context
        assertEquals("ahmyth.mine.king.ahmyth", context.getPackageName());
    }

    @Test
    public void testAppInstalled() {
        // Verify app is installed
        PackageManager pm = context.getPackageManager();
        try {
            pm.getPackageInfo("ahmyth.mine.king.ahmyth", 0);
            assertTrue("App should be installed", true);
        } catch (PackageManager.NameNotFoundException e) {
            fail("App is not installed");
        }
    }

    @Test
    public void testServiceExists() {
        // Verify MainService exists
        Intent serviceIntent = new Intent(context, MainService.class);
        assertNotNull("Service intent should not be null", serviceIntent);
    }

    @Test
    public void testPermissionsAreDeclared() {
        // Check that critical permissions are declared in manifest
        String[] criticalPermissions = {
            android.Manifest.permission.CAMERA,
            android.Manifest.permission.RECORD_AUDIO,
            android.Manifest.permission.ACCESS_FINE_LOCATION,
            android.Manifest.permission.READ_SMS,
            android.Manifest.permission.READ_CONTACTS
        };

        PackageManager pm = context.getPackageManager();
        try {
            android.content.pm.PackageInfo info = pm.getPackageInfo(
                context.getPackageName(), 
                PackageManager.GET_PERMISSIONS
            );
            
            String[] requestedPermissions = info.requestedPermissions;
            assertNotNull("Requested permissions should not be null", requestedPermissions);
            assertTrue("Should request at least 10 permissions", 
                requestedPermissions.length >= 10);

            // Check each critical permission
            for (String permission : criticalPermissions) {
                boolean found = false;
                for (String requested : requestedPermissions) {
                    if (requested.equals(permission)) {
                        found = true;
                        break;
                    }
                }
                assertTrue("Permission " + permission + " should be declared", found);
            }
        } catch (PackageManager.NameNotFoundException e) {
            fail("Package not found");
        }
    }

    @Test
    public void testLauncherAliasConfiguration() {
        // Test that LauncherAlias is properly configured
        PackageManager pm = context.getPackageManager();
        Intent launchIntent = pm.getLaunchIntentForPackage("ahmyth.mine.king.ahmyth");
        assertNotNull("Launch intent should exist", launchIntent);
    }

    @Test
    public void testMainServiceConfiguration() {
        // Verify MainService is properly configured
        try {
            Class.forName("ahmyth.mine.king.ahmyth.MainService");
            assertTrue("MainService class should exist", true);
        } catch (ClassNotFoundException e) {
            fail("MainService class not found");
        }
    }
}
