import Foundation

/// §1 — line-delimited JSON-RPC 2.0 over stdin/stdout. One JSON value per line,
/// UTF-8, terminated by `\n`. No `Content-Length` headers.

struct HostRequestHeader: Decodable {
    let jsonrpc: String?
    let id: Int?
    let method: String?
}

struct HostRequestEnvelope<Params: Decodable>: Decodable {
    let id: Int?
    let method: String
    let params: Params?
}

/// Type erasure so one response encoder can carry every method's payload.
struct HostAnyEncodable: Encodable {
    private let write: (Encoder) throws -> Void

    init<T: Encodable>(_ value: T) {
        write = { encoder in try value.encode(to: encoder) }
    }

    func encode(to encoder: Encoder) throws {
        try write(encoder)
    }
}

/// §1.1 — the tagged union every `result` uses. `ok: true` sits alongside the
/// method's own fields rather than nesting them, so the host reads one shape.
struct HostOkResult<Payload: Encodable>: Encodable {
    let payload: Payload

    private enum Key: String, CodingKey {
        case ok
    }

    func encode(to encoder: Encoder) throws {
        try payload.encode(to: encoder)
        var container = encoder.container(keyedBy: Key.self)
        try container.encode(true, forKey: .ok)
    }
}

struct HostEmptyPayload: Encodable {
    func encode(to encoder: Encoder) throws {
        _ = encoder.container(keyedBy: HostNoKey.self)
    }
}

enum HostNoKey: CodingKey {}

/// §1.1 — the error object every `ok: false` arm carries, and the shape
/// `postObservationError` takes too (§6.1). One encoder, so the two cannot drift
/// into a bare string on one side and an object on the other.
struct HostDomainErrorPayload: Encodable {
    let error: HostDomainError

    init(_ error: HostDomainError) {
        self.error = error
    }

    private enum Key: String, CodingKey {
        case code
        case message
        case detail
    }

    private enum DetailKey: String, CodingKey {
        case changed
        case wouldRequirePath
        case bytes
        case limit
        case permission
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: Key.self)
        try container.encode(error.code, forKey: .code)
        try container.encode(error.message, forKey: .message)

        var detail = container.nestedContainer(keyedBy: DetailKey.self, forKey: .detail)
        switch error.detail {
        case .none:
            break
        case .changed(let fields):
            try detail.encode(fields, forKey: .changed)
        case .wouldRequirePath(let path):
            try detail.encode(path, forKey: .wouldRequirePath)
        case .responseSize(let bytes, let limit):
            try detail.encode(bytes, forKey: .bytes)
            try detail.encode(limit, forKey: .limit)
        case .missingPermission(let permission):
            try detail.encode(permission, forKey: .permission)
        }
    }
}

struct HostFailureResult: Encodable {
    let error: HostDomainError
    /// Echoed on dispatch results only; §6 makes it the one concession to host
    /// bookkeeping so a trace line joins to a tool call without a side table.
    let toolCallId: String?

    private enum Key: String, CodingKey {
        case ok
        case error
        case toolCallId
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: Key.self)
        try container.encode(false, forKey: .ok)
        if let toolCallId {
            try container.encode(toolCallId, forKey: .toolCallId)
        }

        try container.encode(HostDomainErrorPayload(error), forKey: .error)
    }
}

/// §1.1 — the `ok: false` arm of a dispatch result carries the declared dispatch
/// fields too. `maka.cu/1` wrote this arm as `error` and nothing else, which put
/// §6.5's "four required fields on every dispatch result" in direct contradiction
/// with §1.1: `refused()` computed `path` and `tier` and then dropped them here,
/// and a conformant host rejects every refusal that reaches it without them.
struct HostDispatchFailureResult: Encodable {
    let toolCallId: String
    let outcome: HostDispatchOutcome
    let tier: HostDispatchTier
    let path: HostDispatchPath
    let effect: HostDispatchEffect
    let verification: HostVerification
    let error: HostDomainError

    private enum Key: String, CodingKey {
        case ok
        case toolCallId
        case outcome
        case tier
        case path
        case effect
        case verification
        case error
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: Key.self)
        try container.encode(false, forKey: .ok)
        try container.encode(toolCallId, forKey: .toolCallId)
        try container.encode(outcome, forKey: .outcome)
        try container.encode(tier, forKey: .tier)
        try container.encode(path, forKey: .path)
        try container.encode(effect, forKey: .effect)
        try container.encode(verification, forKey: .verification)
        try container.encode(HostDomainErrorPayload(error), forKey: .error)
    }
}

struct HostRPCResponse: Encodable {
    let id: Int?
    let result: HostAnyEncodable?
    let rpcError: HostRPCError?

    private enum Key: String, CodingKey {
        case jsonrpc
        case id
        case result
        case error
    }

    private enum ErrorKey: String, CodingKey {
        case code
        case message
        case data
    }

    private enum DataKey: String, CodingKey {
        case supported
        case field
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: Key.self)
        try container.encode("2.0", forKey: .jsonrpc)
        if let id {
            try container.encode(id, forKey: .id)
        } else {
            try container.encodeNil(forKey: .id)
        }

        if let result {
            try container.encode(result, forKey: .result)
        }

        if let rpcError {
            var errorContainer = container.nestedContainer(keyedBy: ErrorKey.self, forKey: .error)
            try errorContainer.encode(rpcError.code.rawValue, forKey: .code)
            try errorContainer.encode(rpcError.code.message, forKey: .message)

            if rpcError.supportedProtocols != nil || rpcError.field != nil {
                var data = errorContainer.nestedContainer(keyedBy: DataKey.self, forKey: .data)
                if let supported = rpcError.supportedProtocols {
                    try data.encode(supported, forKey: .supported)
                }
                if let field = rpcError.field {
                    try data.encode(field, forKey: .field)
                }
            }
        }
    }
}

enum HostProtocolCodec {
    static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes]
        return encoder
    }()

    static let decoder = JSONDecoder()

    static func encodeLine<T: Encodable>(_ value: T) throws -> Data {
        var data = try encoder.encode(value)
        data.append(0x0A)
        return data
    }

    static func okResponse<Payload: Encodable>(id: Int?, payload: Payload) throws -> Data {
        try encodeLine(
            HostRPCResponse(
                id: id,
                result: HostAnyEncodable(HostOkResult(payload: payload)),
                rpcError: nil
            )
        )
    }

    static func failureResponse(id: Int?, error: HostDomainError, toolCallId: String? = nil) throws -> Data {
        try encodeLine(
            HostRPCResponse(
                id: id,
                result: HostAnyEncodable(HostFailureResult(error: error, toolCallId: toolCallId)),
                rpcError: nil
            )
        )
    }

    static func dispatchFailureResponse(id: Int?, failure: HostDispatchFailureResult) throws -> Data {
        try encodeLine(
            HostRPCResponse(id: id, result: HostAnyEncodable(failure), rpcError: nil)
        )
    }

    static func rpcErrorResponse(id: Int?, error: HostRPCError) throws -> Data {
        try encodeLine(HostRPCResponse(id: id, result: nil, rpcError: error))
    }
}

/// §1 — stdout carries JSON-RPC and nothing else, and responses may arrive out of
/// order because lanes run concurrently. One lock keeps a line atomic.
public final class HostOutputWriter {
    private let lock = NSLock()
    private let sink: (Data) -> Void

    public init(sink: @escaping (Data) -> Void = { data in FileHandle.standardOutput.write(data) }) {
        self.sink = sink
    }

    public func write(_ line: Data) {
        lock.lock()
        defer { lock.unlock() }
        sink(line)
    }
}

/// §7.2 — `$/cancel` answers a request with `aborted` if it has not yet
/// dispatched, and is *ignored* once it has. An action already in flight cannot
/// be un-fired, and reporting `aborted` for one that landed is a lie the host
/// would act on.
public final class HostCancellationRegistry {
    private var cancelled: Set<Int> = []
    private var dispatched: Set<Int> = []
    private let lock = NSLock()

    public init() {}

    public func cancel(id: Int) {
        lock.lock()
        defer { lock.unlock() }
        cancelled.insert(id)
    }

    /// Called at the point of no return. After this, a cancel cannot take effect.
    public func markDispatched(id: Int) {
        lock.lock()
        defer { lock.unlock() }
        dispatched.insert(id)
    }

    public func isCancelledBeforeDispatch(id: Int) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return cancelled.contains(id) && !dispatched.contains(id)
    }

    public func forget(id: Int) {
        lock.lock()
        defer { lock.unlock() }
        cancelled.remove(id)
        dispatched.remove(id)
    }
}

/// §9 — one reader, a set of serial lanes. Within a lane strict FIFO; across
/// lanes concurrent. This exists now, before the capture stream lands, because a
/// `capture.next` long poll that could block a dispatch would be a protocol break
/// to fix later rather than a scheduling detail today.
final class HostLaneScheduler {
    enum Lane: Hashable {
        case control
        case target(pid: pid_t, windowId: UInt32)
        case misc
        case capture(streamId: String)

        var label: String {
            switch self {
            case .control:
                return "control"
            case .target(let pid, let windowId):
                return "target:\(pid):\(windowId)"
            case .misc:
                return "misc"
            case .capture(let streamId):
                return "capture:\(streamId)"
            }
        }
    }

    private var queues: [Lane: DispatchQueue] = [:]
    private let lock = NSLock()
    private let group = DispatchGroup()
    private var shuttingDown = false

    /// §11 — on SIGTERM, work that was queued but has not started is answered
    /// with `aborted` instead of being run. Without this the executor either runs
    /// it anyway or, past the grace deadline, exits owing a response for an id it
    /// has read, which breaks the one-response-per-id obligation §1 states.
    func enqueue(_ lane: Lane, _ work: @escaping () -> Void, ifShuttingDown abort: @escaping () -> Void = {}) {
        let gated: () -> Void = { [self] in
            lock.lock()
            let stopped = shuttingDown
            lock.unlock()

            guard !stopped else {
                abort()
                return
            }

            work()
        }

        queue(for: lane).async(group: group, execute: gated)
    }

    /// Called before waiting on the grace period, so anything still queued
    /// answers rather than being dropped at the deadline.
    func beginShutdown() {
        lock.lock()
        shuttingDown = true
        lock.unlock()
    }

    /// Used by the SIGTERM path (§11) to let in-flight work finish inside the
    /// grace period instead of guessing at a sleep.
    func waitForCompletion(timeout: DispatchTime) -> DispatchTimeoutResult {
        group.wait(timeout: timeout)
    }

    private func queue(for lane: Lane) -> DispatchQueue {
        lock.lock()
        defer { lock.unlock() }

        if let existing = queues[lane] {
            return existing
        }

        let created = DispatchQueue(label: "maka-cu.lane.\(lane.label)")
        queues[lane] = created
        return created
    }
}
