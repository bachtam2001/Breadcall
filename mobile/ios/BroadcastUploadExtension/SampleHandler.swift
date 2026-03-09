import ReplayKit

/*
 Common usage:
 - Call super's lifecycle methods in your lifecycle methods
 - Example:
 ```
 override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
     super.broadcastStarted(withSetupInfo: setupInfo)
     // Your code here
 }
 ```
 */
open class SampleHandler: RPBroadcastSampleHandler {

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

    override open func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
        // User has requested to start the broadcast. Setup info from the UI extension can be supplied but optional.
        DarwinNotificationCenter.default.postNotification(.BroadcastStarted)
        openConnection()
    }

    override open func broadcastPaused() {
        // User has requested to pause the broadcast. Samples will stop being delivered.
    }

    override open func broadcastResumed() {
        // User has requested to resume the broadcast. Samples delivery will resume.
    }

    override open func broadcastFinished() {
        // User has requested to finish the broadcast.
        DarwinNotificationCenter.default.postNotification(.BroadcastStopped)
        closeConnection()
    }

    override open func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
        switch sampleBufferType {
        case RPSampleBufferType.video:
            // Send video sample buffer to the main app
            uploader?.send(sample: sampleBuffer)
        case RPSampleBufferType.audioApp:
            // Send audio sample buffer from the app
            break
        case RPSampleBufferType.audioMic:
            // Send audio sample buffer from the microphone
            break
        @unknown default:
            break
        }
    }
}

// MARK: - SampleUploaderDelegate
extension SampleHandler: SampleUploaderDelegate {
    func sampleUploader(didFailWithError error: Error) {
        // Handle error
        print("Sample uploader failed with error: \(error)")
    }
}
