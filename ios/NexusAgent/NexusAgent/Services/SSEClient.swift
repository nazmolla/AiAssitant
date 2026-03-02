import Foundation

/// Server-Sent Events client for streaming chat responses.
/// Parses the SSE protocol (event: type, data: payload) and delivers typed callbacks.
final class SSEClient: NSObject, URLSessionDataDelegate {
    typealias StatusHandler = (String) -> Void
    typealias MessageHandler = (Message) -> Void
    typealias DoneHandler = () -> Void
    typealias ErrorHandler = (String) -> Void

    private var onStatus: StatusHandler?
    private var onMessage: MessageHandler?
    private var onDone: DoneHandler?
    private var onError: ErrorHandler?

    private var session: URLSession!
    private var task: URLSessionDataTask?
    private var buffer = ""
    private var currentEvent = "message"
    private var currentData = ""

    override init() {
        super.init()
    }

    // MARK: - Public API

    /// Start streaming a chat message.
    /// - Parameters:
    ///   - threadId: The thread ID
    ///   - message: The user's message text
    ///   - attachmentIds: Optional attachment IDs
    ///   - onStatus: Called with "thinking" status updates (e.g. "Analyzing…")
    ///   - onMessage: Called with each accumulated message from the assistant
    ///   - onDone: Called when streaming completes
    ///   - onError: Called if an error occurs
    func stream(
        threadId: String,
        message: String,
        attachmentIds: [String]? = nil,
        onStatus: @escaping StatusHandler,
        onMessage: @escaping MessageHandler,
        onDone: @escaping DoneHandler,
        onError: @escaping ErrorHandler
    ) {
        self.onStatus = onStatus
        self.onMessage = onMessage
        self.onDone = onDone
        self.onError = onError
        self.buffer = ""
        self.currentEvent = "message"
        self.currentData = ""

        // Create a URLSession with self as delegate (for streaming)
        let config = URLSessionConfiguration.default
        config.httpCookieStorage = HTTPCookieStorage.shared
        config.httpShouldSetCookies = true
        config.timeoutIntervalForRequest = 300
        session = URLSession(configuration: config, delegate: self, delegateQueue: nil)

        // Build request body
        struct ChatRequest: Codable {
            let message: String
            let attachmentIds: [String]?
        }
        let body = ChatRequest(message: message, attachmentIds: attachmentIds)
        guard let bodyData = try? JSONEncoder().encode(body) else {
            onError("Failed to encode request")
            return
        }

        let request = APIClient.shared.sseRequest("api/threads/\(threadId)/chat", body: bodyData)
        task = session.dataTask(with: request)
        task?.resume()
    }

    /// Cancel the current stream.
    func cancel() {
        task?.cancel()
        task = nil
        session?.invalidateAndCancel()
    }

    // MARK: - URLSessionDataDelegate

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard let text = String(data: data, encoding: .utf8) else { return }
        buffer += text
        processBuffer()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error = error as? NSError, error.code == NSURLErrorCancelled {
            return // Intentional cancel
        }

        if let error = error {
            DispatchQueue.main.async { [weak self] in
                self?.onError?(error.localizedDescription)
            }
            return
        }

        // If stream ended without a done event
        DispatchQueue.main.async { [weak self] in
            self?.onDone?()
        }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        if let http = response as? HTTPURLResponse, http.statusCode != 200 {
            DispatchQueue.main.async { [weak self] in
                self?.onError?("Server error: \(http.statusCode)")
            }
            completionHandler(.cancel)
            return
        }
        completionHandler(.allow)
    }

    // MARK: - SSE Parser

    private func processBuffer() {
        while let newlineRange = buffer.range(of: "\n") {
            let line = String(buffer[buffer.startIndex..<newlineRange.lowerBound])
            buffer = String(buffer[newlineRange.upperBound...])

            processLine(line)
        }
    }

    private func processLine(_ line: String) {
        // Empty line = dispatch event
        if line.isEmpty {
            dispatchEvent()
            return
        }

        if line.hasPrefix("event:") {
            currentEvent = line.dropFirst(6).trimmingCharacters(in: .whitespaces)
        } else if line.hasPrefix("data:") {
            let data = String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces)
            if currentData.isEmpty {
                currentData = data
            } else {
                currentData += "\n" + data
            }
        }
        // Ignore comments (lines starting with :) and other fields
    }

    private func dispatchEvent() {
        let event = currentEvent
        let data = currentData

        // Reset for next event
        currentEvent = "message"
        currentData = ""

        guard !data.isEmpty else { return }

        DispatchQueue.main.async { [weak self] in
            switch event {
            case "status":
                self?.onStatus?(data)

            case "message":
                // data is a JSON message object
                if let msgData = data.data(using: .utf8),
                   let message = try? JSONDecoder().decode(Message.self, from: msgData) {
                    self?.onMessage?(message)
                }

            case "done":
                self?.onDone?()

            case "error":
                self?.onError?(data)

            default:
                break
            }
        }
    }
}
