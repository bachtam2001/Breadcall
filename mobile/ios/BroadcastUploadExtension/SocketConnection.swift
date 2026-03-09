import Foundation

class SocketConnection: NSObject {
    var inputStream: InputStream?
    var outputStream: OutputStream?
    var delegate: SocketConnectionDelegate?

    init?(filePath: String) {
        super.init()
        var readStream: Unmanaged<CFReadStream>?
        var writeStream: Unmanaged<CFWriteStream>?

        CFStreamCreatePairWithSocketToPath(nil, filePath as CFString, 0, &readStream, &writeStream)

        inputStream = readStream?.takeRetainedValue()
        outputStream = writeStream?.takeRetainedValue()

        inputStream?.delegate = self
        outputStream?.delegate = self

        inputStream?.schedule(in: .current, forMode: .common)
        outputStream?.schedule(in: .current, forMode: .common)

        inputStream?.open()
        outputStream?.open()
    }

    func open() {
        // Streams are already opened in init
    }

    func close() {
        inputStream?.close()
        outputStream?.close()
        inputStream?.remove(from: .current, forMode: .common)
        outputStream?.remove(from: .current, forMode: .common)
    }

    func send(_ data: Data) {
        _ = data.withUnsafeBytes { pointer in
            outputStream?.write(pointer.bindMemory(to: UInt8.self).baseAddress!, maxLength: data.count)
        }
    }
}

// MARK: - StreamDelegate
extension SocketConnection: StreamDelegate {
    func stream(_ aStream: Stream, handle eventCode: Stream.Event) {
        switch eventCode {
        case .openCompleted:
            delegate?.socketConnectionDidOpen(self)
        case .errorOccurred:
            delegate?.socketConnectionDidClose(self)
        case .endEncountered:
            delegate?.socketConnectionDidClose(self)
        default:
            break
        }
    }
}

protocol SocketConnectionDelegate: AnyObject {
    func socketConnectionDidOpen(_ connection: SocketConnection)
    func socketConnectionDidClose(_ connection: SocketConnection)
}
