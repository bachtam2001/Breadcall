import Foundation
import ReplayKit
import React

@objc(ScreenCaptureModule)
class ScreenCaptureModule: RCTEventEmitter {

    private static let shared = ScreenCaptureModule()
    private var capturePromise: RCTPromiseResolveBlock?
    private var captureReject: RCTPromiseRejectBlock?
    private var isCapturing = false
    private var streamId: Int = 0

    override init() {
        super.init()
        ScreenCaptureModule.shared = self
    }

    override class func requiresMainQueueSetup() -> Bool {
        return true
    }

    @objc
    override func supportedEvents() -> [String]! {
        return ["onCaptureStarted", "onCaptureStopped"]
    }

    @objc
    func startCapture(_ options: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {

        if isCapturing {
            reject("ALREADY_CAPTURE", "Screen capture already in progress", nil)
            return
        }

        capturePromise = resolve
        captureReject = reject

        // Check if ReplayKit is available
        if #available(iOS 11.0, *) {
            // Broadcast extension for iOS
            let bundleIdentifier = options["bundleIdentifier"] as? String ?? "com.breadcall.BroadcastUploadExtension"

            RPSystemBroadcastPickerView.show(for: [bundleIdentifier]) { controller in
                controller.preferredFrameRate = Float(options["frameRate"] as? Int ?? 30)
                controller.preferredVideoDimensions = RPVideoDimension(
                    width: options["width"] as? Int ?? 1280,
                    height: options["height"] as? Int ?? 720
                )
                return controller
            }

            // Note: Actual broadcast start is handled by the extension
            // This just shows the picker. The extension will communicate back via Darwin notifications
            NotificationCenter.default.addObserver(
                self,
                selector: #selector(broadcastStarted),
                name: NSNotification.Name("BroadcastStarted"),
                object: nil
            )

            resolve([
                "streamId": 0,
                "width": options["width"] as? Int ?? 1280,
                "height": options["height"] as? Int ?? 720,
                "frameRate": options["frameRate"] as? Int ?? 30
            ])
        } else {
            reject("NOT_SUPPORTED", "ReplayKit not available on this iOS version", nil)
        }
    }

    @objc
    func stopCapture(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {

        if #available(iOS 11.0, *) {
            RPSystemBroadcastPickerView.hide()

            NotificationCenter.default.post(name: NSNotification.Name("StopBroadcast"), object: nil)

            isCapturing = false

            sendEvent(withName: "onCaptureStopped", body: ["stopped": true])

            resolve(["stopped": true])
        } else {
            reject("NOT_SUPPORTED", "ReplayKit not available", nil)
        }
    }

    @objc
    func startBroadcast(_ options: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        startCapture(options, resolver: resolve, rejecter: reject)
    }

    @objc
    func stopBroadcast(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        stopCapture(resolve, rejecter: reject)
    }

    @objc
    private func broadcastStarted() {
        isCapturing = true
        streamId = Int(Date().timeIntervalSince1970.truncatingRemainder(dividingBy: Double(Int32.max)))

        capturePromise?([
            "streamId": streamId,
            "width": 1280,
            "height": 720,
            "frameRate": 30
        ])
        capturePromise = nil

        sendEvent(withName: "onCaptureStarted", body: [
            "streamId": streamId,
            "width": 1280,
            "height": 720,
            "frameRate": 30
        ])
    }
}

// Sample Handler for Broadcast Upload Extension
// This would go in ios/BroadcastUploadExtension/SampleHandler.swift
/*
import ReplayKit

class SampleHandler: RPBroadcastSampleHandler {

    private var clientConnection: SocketConnection?
    private var uploader: SampleUploader?

    var socketFilePath: String {
        let sharedContainer = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.com.breadcall")
        return sharedContainer?.appendingPathComponent("broadcast.sock").path ?? ""
    }

    override init() {
        super.init()
        if let connection = SocketConnection(filePath: socketFilePath) {
            clientConnection = connection
            let sampleUploader = SampleUploader(connection: connection)
            sampleUploader.delegate = self
            uploader = sampleUploader
        }
    }

    override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
        DarwinNotificationCenter.default.postNotification(.BroadcastStarted)
        openConnection()
    }

    override func broadcastPaused() {
        // User wants to pause broadcast
    }

    override func broadcastResumed() {
        // User wants to resume broadcast
    }

    override func broadcastFinished() {
        DarwinNotificationCenter.default.postNotification(.BroadcastStopped)
        closeConnection()
    }

    override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
        switch sampleBufferType {
        case RPSampleBufferType.video:
            uploader?.send(sample: sampleBuffer)
        default:
            break
        }
    }

    private func openConnection() {
        clientConnection?.open()
    }

    private func closeConnection() {
        clientConnection?.close()
    }
}
*/
