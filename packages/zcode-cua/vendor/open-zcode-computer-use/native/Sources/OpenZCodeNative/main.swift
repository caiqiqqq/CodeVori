import AppKit
import ApplicationServices
import CoreGraphics
import Darwin
import Foundation
import OpenComputerUseKit

private struct DisplayDescriptor: Encodable {
    let index: Int
    let displayId: String
    let bounds: HostRect
    let pixelBounds: HostRect
    let scaleFactor: Double
    let main: Bool
}

private struct CursorDescriptor: Encodable {
    let x: Double
    let y: Double
}

private struct FrontmostDescriptor: Encodable {
    let pid: Int32?
}

private struct HoldResult: Encodable {
    let actionSent: Bool
    let dispatchStatus: String
}

private enum NativeCommandError: Error, LocalizedError {
    case invalidArguments(String)
    case unsupportedKey(String)
    case eventCreationFailed

    var errorDescription: String? {
        switch self {
        case let .invalidArguments(message):
            return message
        case let .unsupportedKey(key):
            return "Unsupported key: \(key)"
        case .eventCreationFailed:
            return "Could not create a keyboard event."
        }
    }
}

@main
enum OpenZCodeNative {
    static func main() {
        do {
            try run()
        } catch {
            let message = (error as? LocalizedError)?.errorDescription
                ?? String(describing: error)
            FileHandle.standardError.write(Data((message + "\n").utf8))
            exit(EXIT_FAILURE)
        }
    }

    private static func run() throws {
        let arguments = Array(CommandLine.arguments.dropFirst())
        switch arguments.first ?? "host" {
        case "host":
            let server = HostProtocolServer()
            server.run()
            exit(server.exitStatus)
        case "displays":
            try printJSON(displays())
        case "permissions":
            try printJSON([
                "accessibility": AXIsProcessTrusted(),
                "screenRecording": CGPreflightScreenCaptureAccess(),
            ])
        case "cursor":
            let point = CGEvent(source: nil)?.location ?? .zero
            try printJSON(CursorDescriptor(x: point.x, y: point.y))
        case "frontmost":
            try printJSON(
                FrontmostDescriptor(
                    pid: NSWorkspace.shared.frontmostApplication?.processIdentifier
                )
            )
        case "activate":
            try activate(arguments: Array(arguments.dropFirst()))
        case "hold-key":
            try holdKey(arguments: Array(arguments.dropFirst()))
        default:
            throw NativeCommandError.invalidArguments(
                "Usage: OpenZCodeNative host | displays | cursor | frontmost | activate <pid> | hold-key <pid> <key> <duration> [modifiers...]"
            )
        }
    }

    private static func displays() -> [DisplayDescriptor] {
        var count: UInt32 = 0
        CGGetActiveDisplayList(0, nil, &count)
        var ids = Array(repeating: CGDirectDisplayID(), count: Int(count))
        CGGetActiveDisplayList(count, &ids, &count)
        return ids.prefix(Int(count)).enumerated().map { index, id in
            let bounds = CGDisplayBounds(id)
            let mode = CGDisplayCopyDisplayMode(id)
            let pixelsWide = Double(mode?.pixelWidth ?? CGDisplayPixelsWide(id))
            let pixelsHigh = Double(mode?.pixelHeight ?? CGDisplayPixelsHigh(id))
            let scale = bounds.width > 0 ? pixelsWide / bounds.width : 1
            return DisplayDescriptor(
                index: index,
                displayId: String(id),
                bounds: HostRect(bounds),
                pixelBounds: HostRect(
                    x: 0,
                    y: 0,
                    width: pixelsWide,
                    height: pixelsHigh
                ),
                scaleFactor: scale,
                main: id == CGMainDisplayID()
            )
        }
    }

    private static func holdKey(arguments: [String]) throws {
        guard arguments.count >= 3,
              let pid = Int32(arguments[0]),
              let duration = Double(arguments[2]),
              duration.isFinite,
              duration >= 0
        else {
            throw NativeCommandError.invalidArguments(
                "hold-key requires <pid> <key> <duration> [modifiers...]"
            )
        }

        let modifierMap: [String: HostKeyModifier] = [
            "cmd": .command,
            "command": .command,
            "meta": .command,
            "shift": .shift,
            "alt": .option,
            "option": .option,
            "ctrl": .control,
            "control": .control,
            "fn": .fn,
        ]
        let modifiers = try arguments.dropFirst(3).map { raw -> HostKeyModifier in
            guard let modifier = modifierMap[raw.lowercased()] else {
                throw NativeCommandError.invalidArguments("Unsupported modifier: \(raw)")
            }
            return modifier
        }
        guard let stroke = hostKeyStroke(name: canonicalKey(arguments[1]), modifiers: modifiers) else {
            throw NativeCommandError.unsupportedKey(arguments[1])
        }
        guard let source = CGEventSource(stateID: .hidSystemState),
              let down = CGEvent(
                keyboardEventSource: source,
                virtualKey: stroke.keyCode,
                keyDown: true
              ),
              let up = CGEvent(
                keyboardEventSource: source,
                virtualKey: stroke.keyCode,
                keyDown: false
              )
        else {
            throw NativeCommandError.eventCreationFailed
        }

        down.flags = stroke.flags
        up.flags = stroke.flags
        if stroke.carriesCharacters {
            down.keyboardSetUnicodeString(
                stringLength: stroke.characters.count,
                unicodeString: stroke.characters
            )
            up.keyboardSetUnicodeString(
                stringLength: stroke.characters.count,
                unicodeString: stroke.characters
            )
        }
        // ZCode 取消/超时发送 SIGTERM 时，先配对抬键，再退出，避免遗留按键状态。
        let interrupted = DispatchSemaphore(value: 0)
        let termination = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .global())
        signal(SIGTERM, SIG_IGN)
        termination.setEventHandler { interrupted.signal() }
        termination.resume()
        defer { termination.cancel() }
        down.postToPid(pid)
        _ = interrupted.wait(timeout: .now() + min(duration, 30))
        up.postToPid(pid)
        try printJSON(HoldResult(actionSent: true, dispatchStatus: "accepted"))
    }

    private static func activate(arguments: [String]) throws {
        guard arguments.count == 1, let pid = Int32(arguments[0]) else {
            throw NativeCommandError.invalidArguments("activate requires <pid>")
        }
        guard let app = NSRunningApplication(processIdentifier: pid) else {
            throw NativeCommandError.invalidArguments("No running application has pid \(pid)")
        }
        let activated = app.activate(options: [.activateAllWindows])
        Thread.sleep(forTimeInterval: 0.05)
        let active = NSWorkspace.shared.frontmostApplication?.processIdentifier == pid
        try printJSON(["activated": activated, "active": active])
    }

    private static func canonicalKey(_ raw: String) -> String {
        let aliases: [String: String] = [
            "enter": "Return",
            "return": "Return",
            "tab": "Tab",
            "space": "Space",
            "esc": "Escape",
            "escape": "Escape",
            "backspace": "Backspace",
            "delete": "Backspace",
            "forwarddelete": "ForwardDelete",
            "up": "Up",
            "down": "Down",
            "left": "Left",
            "right": "Right",
            "home": "Home",
            "end": "End",
            "pageup": "PageUp",
            "pagedown": "PageDown",
        ]
        let lower = raw.lowercased()
        if let alias = aliases[lower] {
            return alias
        }
        if lower.count >= 2, lower.first == "f", Int(lower.dropFirst()) != nil {
            return lower.uppercased()
        }
        return raw
    }

    private static func printJSON<T: Encodable>(_ value: T) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(value)
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0A]))
    }
}
