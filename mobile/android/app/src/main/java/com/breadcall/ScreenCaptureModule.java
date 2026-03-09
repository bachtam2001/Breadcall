package com.breadcall;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.AudioPlaybackCaptureConfiguration;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.IBinder;
import android.util.DisplayMetrics;
import android.util.Log;

import com.facebook.react.bridge.ActivityEventListener;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.BaseActivityEventListener;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import java.util.HashMap;
import java.util.Map;

public class ScreenCaptureModule extends ReactContextBaseJavaModule {
    private static final String TAG = "ScreenCaptureModule";
    private static final int REQUEST_CODE_SCREEN_CAPTURE = 1001;
    private static final String CHANNEL_ID = "breadcall_screen_capture";
    private static final int NOTIFICATION_ID = 1001;

    private MediaProjection mediaProjection;
    private MediaProjectionManager projectionManager;
    private VirtualDisplay virtualDisplay;
    private Promise capturePromise;
    private boolean isCapturing = false;
    private int streamId = 0;

    private final ActivityEventListener activityEventListener = new BaseActivityEventListener() {
        @Override
        public void onActivityResult(Activity activity, int requestCode, int resultCode, Intent data) {
            if (requestCode == REQUEST_CODE_SCREEN_CAPTURE) {
                handleScreenCaptureResult(resultCode, data);
            }
        }
    };

    public ScreenCaptureModule(ReactApplicationContext reactContext) {
        super(reactContext);
        projectionManager = (MediaProjectionManager) reactContext.getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        reactContext.addActivityEventListener(activityEventListener);
        createNotificationChannel();
    }

    @Override
    public String getName() {
        return "ScreenCaptureModule";
    }

    @Override
    public Map<String, Object> getConstants() {
        final Map<String, Object> constants = new HashMap<>();
        constants.put("REQUEST_CODE", REQUEST_CODE_SCREEN_CAPTURE);
        return constants;
    }

    @ReactMethod
    public void startCapture(ReadableMap options, Promise promise) {
        try {
            if (isCapturing) {
                promise.reject("ALREADY_CAPTURE", "Screen capture already in progress");
                return;
            }

            this.capturePromise = promise;

            // Get intent for screen capture
            Intent captureIntent = projectionManager.createScreenCaptureIntent();

            // Start foreground service for Android 10+
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForegroundService();
            }

            // Request screen capture permission
            getCurrentActivity().startActivityForResult(captureIntent, REQUEST_CODE_SCREEN_CAPTURE);
        } catch (Exception e) {
            Log.e(TAG, "Start capture error", e);
            promise.reject("START_ERROR", e.getMessage());
        }
    }

    private void handleScreenCaptureResult(int resultCode, Intent data) {
        if (resultCode != Activity.RESULT_OK || data == null) {
            if (capturePromise != null) {
                capturePromise.reject("PERMISSION_DENIED", "User denied screen capture permission");
            }
            capturePromise = null;
            return;
        }

        try {
            mediaProjection = projectionManager.getMediaProjection(resultCode, data);

            // Get capture parameters
            int width = 1280;
            int height = 720;
            int frameRate = 30;
            int density = 320;

            // Create virtual display
            virtualDisplay = mediaProjection.createVirtualDisplay(
                "BreadCall Screen Capture",
                width,
                height,
                density,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR |
                DisplayManager.VIRTUAL_DISPLAY_FLAG_PUBLIC |
                DisplayManager.VIRTUAL_DISPLAY_FLAG_PRESENTATION,
                null, // Surface from encoder
                null,
                null
            );

            // Generate stream ID for WebRTC integration
            streamId = generateStreamId();

            isCapturing = true;

            WritableMap result = Arguments.createMap();
            result.putInt("streamId", streamId);
            result.putInt("width", width);
            result.putInt("height", height);
            result.putInt("frameRate", frameRate);

            if (capturePromise != null) {
                capturePromise.resolve(result);
            }
            capturePromise = null;

            // Emit event to JS
            emitEvent("onCaptureStarted", result);

            Log.i(TAG, "Screen capture started with streamId: " + streamId);
        } catch (Exception e) {
            Log.e(TAG, "Handle capture result error", e);
            if (capturePromise != null) {
                capturePromise.reject("CAPTURE_ERROR", e.getMessage());
            }
            capturePromise = null;
        }
    }

    @ReactMethod
    public void stopCapture(Promise promise) {
        try {
            if (virtualDisplay != null) {
                virtualDisplay.release();
                virtualDisplay = null;
            }

            if (mediaProjection != null) {
                mediaProjection.stop();
                mediaProjection = null;
            }

            stopForegroundService();
            isCapturing = false;

            WritableMap result = Arguments.createMap();
            result.putBoolean("stopped", true);

            emitEvent("onCaptureStopped", result);

            if (promise != null) {
                promise.resolve(result);
            }

            Log.i(TAG, "Screen capture stopped");
        } catch (Exception e) {
            Log.e(TAG, "Stop capture error", e);
            if (promise != null) {
                promise.reject("STOP_ERROR", e.getMessage());
            }
        }
    }

    @ReactMethod
    public void requestForegroundServicePermission(Promise promise) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                startForegroundService();
                promise.resolve(true);
            } catch (Exception e) {
                promise.reject("PERMISSION_ERROR", e.getMessage());
            }
        } else {
            promise.resolve(true);
        }
    }

    private void startForegroundService() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent serviceIntent = new Intent(getReactApplicationContext(), ScreenCaptureService.class);
            serviceIntent.putExtra("channelId", CHANNEL_ID);
            serviceIntent.putExtra("notificationId", NOTIFICATION_ID);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getReactApplicationContext().startForegroundService(serviceIntent);
            }
        }
    }

    private void stopForegroundService() {
        Intent serviceIntent = new Intent(getReactApplicationContext(), ScreenCaptureService.class);
        getReactApplicationContext().stopService(serviceIntent);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager =
                (NotificationManager) getReactApplicationContext().getSystemService(Context.NOTIFICATION_SERVICE);

            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Screen Capture",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Shows when screen capture is active");
            channel.setShowBadge(false);

            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private int generateStreamId() {
        return (int) (System.currentTimeMillis() % Integer.MAX_VALUE);
    }

    private void emitEvent(String eventName, WritableMap params) {
        getReactApplicationContext()
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
            .emit(eventName, params);
    }

    // Static method to get MediaProjection for WebRTC integration
    public static MediaProjection getMediaProjection() {
        // This would need to be accessed via singleton pattern
        return null;
    }
}
