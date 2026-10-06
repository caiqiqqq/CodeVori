import AppKit
import CoreGraphics
import Darwin
import Foundation

/// The running applications and the frontmost one, asked of the machine on every
/// call.
///
/// `NSWorkspace.shared.runningApplications` and
/// `NSWorkspace.shared.frontmostApplication` are not queries. They are a cache
/// that AppKit refreshes out of notifications, and off the main thread of a
/// process whose main run loop never runs, that refresh never lands. The executor
/// is exactly that process: `HostProtocolServer.run()` parks the main thread in
/// `readLine` and answers every request on a `HostLaneScheduler` lane, which is
/// the same reason `session.end` cannot touch `SoftwareCursorOverlay`.
///
/// Measured on macOS 26.5, one process, reads on a detached thread, TextEdit
/// started externally between the two rows:
///
/// ```
///                                   t0                    t1 (TextEdit running)
/// NSWorkspace.runningApplications    93, TextEdit absent   93, TextEdit absent
/// NSWorkspace.frontmostApplication   iTerm2                iTerm2 (after TextEdit
///                                                          and Calculator were
///                                                          each activated)
/// proc_listpids + NSRunningApplication
///                                   93, TextEdit absent   97, TextEdit present
/// front layer-0 window owner         iTerm2                Calculator
/// ```
///
/// The same reads on the *main* thread of the same process do update, which is
/// why every test and every desktop build saw a working list and no real-machine
/// run ever did: the frozen list is what the lanes see, and the lanes are what
/// answers `apps.list` and `apps.launch`. An executor blind to everything started
/// after it cannot resolve an app it has just launched itself — the launch
/// succeeds, the process exists, and the poll in `AppDiscovery.resolve` searches a
/// list that will never contain it until the executor is restarted.
///
/// Cost, measured at ~600 processes and ~95 applications: 1.1 ms for the whole
/// list, 2.1 ms for the frontmost owner. The cached reads were 0.5 ms and 0.0 ms,
/// so this is the same order of magnitude, not one slower.
enum LiveApplicationInventory {
    private struct CoalitionInfo {
        var resource: UInt64 = 0
        var jetsam: UInt64 = 0
        var reserved1: UInt64 = 0
        var reserved2: UInt64 = 0
        var reserved3: UInt64 = 0
    }

    /// Every pid the kernel currently knows about. `proc_listpids` is a syscall,
    /// so it cannot be stale, and it is the only enumeration here that does not
    /// route through AppKit's notification cache.
    static func processIdentifiers() -> [pid_t] {
        var capacity = 0

        // Two rounds at most in the common case; the loop exists because the
        // process table can grow between the sizing call and the fetch, and a
        // full buffer is indistinguishable from a truncated one.
        for _ in 0..<4 {
            let sized = proc_listpids(UInt32(PROC_ALL_PIDS), 0, nil, 0)
            guard sized > 0 else {
                return []
            }

            capacity = max(capacity, Int(sized) / MemoryLayout<pid_t>.size + 64)
            var buffer = [pid_t](repeating: 0, count: capacity)
            let written = proc_listpids(
                UInt32(PROC_ALL_PIDS),
                0,
                &buffer,
                Int32(capacity * MemoryLayout<pid_t>.size)
            )
            guard written > 0 else {
                return []
            }

            let count = Int(written) / MemoryLayout<pid_t>.size
            guard count < capacity else {
                capacity *= 2
                continue
            }

            return buffer[0..<count].filter { $0 > 0 }
        }

        return []
    }

    /// The applications among those pids. `NSRunningApplication(processIdentifier:)`
    /// is a per-pid LaunchServices lookup rather than a read of the cached array,
    /// and it answers `nil` for anything LaunchServices does not consider an
    /// application — a bare `/bin/sleep` child is `nil` here, so this list covers
    /// what `NSWorkspace.shared.runningApplications` covered and nothing more.
    static func runningApplications() -> [NSRunningApplication] {
        processIdentifiers().compactMap(NSRunningApplication.init(processIdentifier:))
    }

    /// A WKWebView content process belongs to the same resource and jetsam
    /// coalitions as its host. Both ids are required and the result must be
    /// unique; process name alone is never enough.
    static func uniqueWebContentProcess(for hostPid: pid_t) -> pid_t? {
        guard let hostCoalition = coalitionInfo(pid: hostPid),
              hostCoalition.resource != 0,
              hostCoalition.jetsam != 0
        else {
            return nil
        }

        let matches = processIdentifiers().filter { pid in
            guard pid != hostPid,
                  processPath(pid: pid).hasSuffix("/com.apple.WebKit.WebContent"),
                  let candidate = coalitionInfo(pid: pid)
            else {
                return false
            }
            return candidate.resource == hostCoalition.resource
                && candidate.jetsam == hostCoalition.jetsam
        }
        return matches.count == 1 ? matches[0] : nil
    }

    static func coalitionProbeAvailable(pid: pid_t = getpid()) -> Bool {
        coalitionInfo(pid: pid) != nil
    }

    private static func coalitionInfo(pid: pid_t) -> CoalitionInfo? {
        var info = CoalitionInfo()
        let read = withUnsafeMutablePointer(to: &info) { pointer in
            proc_pidinfo(
                pid,
                20, // PROC_PIDCOALITIONINFO from XNU's proc_info_private.h.
                0,
                pointer,
                Int32(MemoryLayout<CoalitionInfo>.size)
            )
        }
        return read == MemoryLayout<CoalitionInfo>.size ? info : nil
    }

    private static func processPath(pid: pid_t) -> String {
        var buffer = [CChar](repeating: 0, count: 4096)
        let count = proc_pidpath(pid, &buffer, UInt32(buffer.count))
        guard count > 0 else {
            return ""
        }
        let bytes = buffer.prefix(Int(count)).prefix { $0 != 0 }.map {
            UInt8(bitPattern: $0)
        }
        return String(decoding: bytes, as: UTF8.self)
    }

    /// The pid that owns the frontmost ordinary window.
    ///
    /// Read from the window server's front-to-back list, for the reason above:
    /// `frontmostApplication` answers with whatever was frontmost when the
    /// process started. Layer 0 is the ordinary application layer, so menus,
    /// the Dock and other chrome do not claim the foreground.
    static func frontmostApplicationPid() -> pid_t? {
        guard let infoList = CGWindowListCopyWindowInfo(
            [.optionOnScreenOnly, .excludeDesktopElements],
            kCGNullWindowID
        ) as? [[String: Any]] else {
            return nil
        }

        for info in infoList {
            guard
                let layer = info[kCGWindowLayer as String] as? Int,
                layer == 0,
                let pid = info[kCGWindowOwnerPID as String] as? pid_t
            else {
                continue
            }

            return pid
        }

        return nil
    }
}
