package com.breadcall

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.*
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder
import android.util.DisplayMetrics
import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

class ScreenCaptureModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "ScreenCaptureModule"
        private const val REQUEST_CODE_SCREEN_CAPTURE = 1001
        private const val CHANNEL_ID = "breadcall_screen_capture"
        private const val NOTIFICATION_ID = 1001
    }

    private var mediaProjection: MediaProjection? = null
    private var projectionManager: MediaProjectionManager? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var capturePromise: Promise? = null
    private var isCapturing = false
    private var streamId = 0
    private var imageReader: ImageReader? = null

    private val activityEventListener = object : BaseActivityEventListener() {
        override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
            if (requestCode == REQUEST_CODE_SCREEN_CAPTURE) {
                handleScreenCaptureResult(resultCode, data)
            }
        }
    }

    init {
        projectionManager = reactContext.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        reactContext.addActivityEventListener(activityEventListener)
        createNotificationChannel()
    }

    override fun getName(): String = "ScreenCaptureModule"

    override fun getConstants(): Map<String, Any> {
        return mapOf(
            "REQUEST_CODE" to REQUEST_CODE_SCREEN_CAPTURE
        )
    }

    @ReactMethod
    fun startCapture(options: ReadableMap, promise: Promise) {
        try {
            if (isCapturing) {
                promise.reject("ALREADY_CAPTURE", "Screen capture already in progress")
                return
            }

            capturePromise = promise

            // Get capture parameters
            val width = options.getInt("width").takeIf { it > 0 } ?: 1280
            val height = options.getInt("height").takeIf { it > 0 } ?: 720
            val frameRate = options.getInt("frameRate").takeIf { it > 0 } ?: 30
            val density = options.getInt("density").takeIf { it > 0 } ?: 320
            val captureAudio = options.getBoolean("captureAudio")

            // Start foreground service for Android 10+
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForegroundService()
            }

            // Request screen capture permission
            currentActivity?.startActivityForResult(
                projectionManager?.createScreenCaptureIntent(),
                REQUEST_CODE_SCREEN_CAPTURE
            )
        } catch (e: Exception) {
            Log.e(TAG, "Start capture error", e)
            promise.reject("START_ERROR", e.message)
        }
    }

    private fun handleScreenCaptureResult(resultCode: Int, data: Intent?) {
        if (resultCode != Activity.RESULT_OK || data == null) {
            capturePromise?.reject("PERMISSION_DENIED", "User denied screen capture permission")
            capturePromise = null
            return
        }

        try {
            mediaProjection = projectionManager?.getMediaProjection(resultCode, data)

            // Get capture parameters
            val width = 1280
            val height = 720
            val dpi = 320

            // Create ImageReader for frame capture
            imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)

            // Create virtual display
            virtualDisplay = mediaProjection?.createVirtualDisplay(
                "BreadCall Screen Capture",
                width,
                height,
                dpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR or
                        DisplayManager.VIRTUAL_DISPLAY_FLAG_PUBLIC or
                        DisplayManager.VIRTUAL_DISPLAY_FLAG_PRESENTATION,
                imageReader?.surface,
                null,
                null
            )

            // Generate stream ID for WebRTC integration
            streamId = (System.currentTimeMillis() % Int.MAX_VALUE).toInt()

            isCapturing = true

            val result = Arguments.createMap().apply {
                putInt("streamId", streamId)
                putInt("width", width)
                putInt("height", height)
                putInt("frameRate", 30)
            }

            capturePromise?.resolve(result)
            capturePromise = null

            // Emit event to JS
            emitEvent("onCaptureStarted", result)

            Log.i(TAG, "Screen capture started with streamId: $streamId")
        } catch (e: Exception) {
            Log.e(TAG, "Handle capture result error", e)
            capturePromise?.reject("CAPTURE_ERROR", e.message)
            capturePromise = null
        }
    }

    @ReactMethod
    fun stopCapture(promise: Promise) {
        try {
            // Release virtual display
            virtualDisplay?.release()
            virtualDisplay = null

            // Stop media projection
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                mediaProjection?.stop()
            }
            mediaProjection = null

            // Release image reader
            imageReader?.close()
            imageReader = null

            // Stop foreground service
            stopForegroundService()
            isCapturing = false

            val result = Arguments.createMap().apply {
                putBoolean("stopped", true)
            }

            emitEvent("onCaptureStopped", result)
            promise.resolve(result)

            Log.i(TAG, "Screen capture stopped")
        } catch (e: Exception) {
            Log.e(TAG, "Stop capture error", e)
            promise.reject("STOP_ERROR", e.message)
        }
    }

    @ReactMethod
    fun requestForegroundServicePermission(promise: Promise) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                startForegroundService()
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("PERMISSION_ERROR", e.message)
            }
        } else {
            promise.resolve(true)
        }
    }

    private fun startForegroundService() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val serviceIntent = Intent(reactApplicationContext, ScreenCaptureService::class.java).apply {
                putExtra("channelId", CHANNEL_ID)
                putExtra("notificationId", NOTIFICATION_ID)
            }
            reactApplicationContext.startForegroundService(serviceIntent)
        }
    }

    private fun stopForegroundService() {
        val serviceIntent = Intent(reactApplicationContext, ScreenCaptureService::class.java)
        reactApplicationContext.stopService(serviceIntent)
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Screen Capture",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows when screen capture is active"
                setShowBadge(false)
            }

            val manager = reactApplicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }

    private fun emitEvent(eventName: String, params: ReadableMap) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }

    override fun onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy()
        stopCapture(Promise())
    }
}
