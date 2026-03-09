import Foundation

enum DarwinNotification: String {
    case BroadcastStarted = "BroadcastStarted"
    case BroadcastStopped = "BroadcastStopped"
}

extension NotificationCenter {
    func postNotification(_ notification: DarwinNotification) {
        post(name: NSNotification.Name(rawValue: notification.rawValue), object: nil)
    }
}
