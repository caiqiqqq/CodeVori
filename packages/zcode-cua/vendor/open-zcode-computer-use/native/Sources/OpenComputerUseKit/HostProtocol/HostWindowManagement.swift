import ApplicationServices
import CoreGraphics
import Foundation

/// §6.1 — window management: the three element actions whose subject is the
/// window itself rather than something inside it.
///
/// Everything here is the part that can be decided without a desktop: what a
/// requested geometry compares equal to, which attribute an action writes, and
/// when the window server has caught up with a write. The dispatch itself is in
/// `HostProtocolServer+Observe.swift` beside the other element actions, because a
/// window action takes the same frame binding, the same refusal vocabulary and
/// the same result shape as a click.
///
/// **Why these are `dispatch.element` actions and not a method of their own.**
/// The window is already addressable: the snapshot's tree is rooted at it, so it
/// is the element at `depth == 0` and it already carries a token, a digest and a
/// binding. A new method would have to re-derive all four of those, and §2's
/// version and conformance cost would buy nothing the union does not already
/// give. What the union was missing is a member carrying geometry, which is what
/// `move_window` and `resize_window` add.
///
/// **Why the target must be the snapshot root.** §5.3 puts `element.frame` in
/// window-local points and `snapshot.target.bounds` in screen points. A window's
/// own position is the one geometry on this wire that is screen-space, so
/// accepting a non-root target would put two spaces in one request field and the
/// executor would have to guess which one it was handed — which is the defect
/// §5.3 exists to make impossible. Measured besides: `AXPosition` and `AXSize`
/// are not settable on any ordinary control (three Calculator buttons, all
/// `false`), so the gate refuses nothing that would otherwise have worked.

/// A geometry, or a boolean, written the way the digest writes one: whole logical
/// points, so a readback that differs from the request only in the sub-pixel
/// digits is the same answer rather than a third value.
///
/// The rounding is `HostDigest.canonicalNumber`'s, deliberately — §4.3 already
/// decided that a window's frame is compared at whole-point resolution, and two
/// resolutions for one rectangle is how the executor would refuse a dispatch
/// against a window nothing had moved. It is guarded against the values
/// `Int(_:)` traps on, because a readback comes from another process.
public func hostWholePoints(_ value: Double) -> String {
    guard value.isFinite, value.magnitude < 1e15 else {
        return "out_of_range"
    }

    return String(Int(value.rounded()))
}

public func hostCanonicalPoint(_ point: CGPoint) -> String {
    "[" + hostWholePoints(Double(point.x)) + "," + hostWholePoints(Double(point.y)) + "]"
}

public func hostCanonicalSize(_ size: CGSize) -> String {
    "[" + hostWholePoints(Double(size.width)) + "," + hostWholePoints(Double(size.height)) + "]"
}

public func hostCanonicalFlag(_ flag: Bool) -> String {
    flag ? "true" : "false"
}

/// The one attribute a window action writes, and the four things the dispatcher
/// has to be able to do with it. Built once from the action so the body that
/// performs it is linear: a `switch` per step is how the readback and the request
/// end up being taken from two different attributes.
struct HostWindowSubject {
    /// The Accessibility attribute. Also what `AXUIElementIsAttributeSettable` is
    /// asked about, so the settability refusal and the write cannot name two
    /// different things.
    let attribute: String
    /// The requested value, canonical, ready to compare against a readback.
    let requested: String
    let read: (AXUIElement) -> String?
    let write: (AXUIElement) -> AXError
    /// Whether the window server's own idea of the window agrees with the value
    /// the application read back. `nil` is the window having left the on-screen
    /// list, which is what a minimise looks like from the window server.
    let serverAgrees: (CGRect?, String?) -> Bool
}

func hostWindowSubject(for action: HostElementAction) -> HostWindowSubject? {
    switch action {
    case .moveWindow(let position):
        let target = position.cgPoint
        return HostWindowSubject(
            attribute: kAXPositionAttribute,
            requested: hostCanonicalPoint(target),
            read: { HostAX.point($0, kAXPositionAttribute).map(hostCanonicalPoint) },
            write: { HostAX.write($0, kAXPositionAttribute, point: target) },
            serverAgrees: { listed, readback in
                guard let listed else {
                    return false
                }
                return hostCanonicalPoint(listed.origin) == readback
            }
        )

    case .resizeWindow(let size):
        let target = size.cgSize
        return HostWindowSubject(
            attribute: kAXSizeAttribute,
            requested: hostCanonicalSize(target),
            read: { HostAX.size($0, kAXSizeAttribute).map(hostCanonicalSize) },
            write: { HostAX.write($0, kAXSizeAttribute, size: target) },
            serverAgrees: { listed, readback in
                guard let listed else {
                    return false
                }
                return hostCanonicalSize(listed.size) == readback
            }
        )

    case .minimizeWindow:
        return HostWindowSubject(
            attribute: kAXMinimizedAttribute,
            requested: hostCanonicalFlag(true),
            read: { HostAX.bool($0, kAXMinimizedAttribute).map(hostCanonicalFlag) },
            write: { HostAX.write($0, kAXMinimizedAttribute, flag: true) },
            // A minimised window leaves the on-screen window list. That is the
            // whole of what the window server has to say about it, and it is what
            // makes the post-observation's `window_gone` a settled fact rather
            // than a race with the animation.
            serverAgrees: { listed, _ in listed == nil }
        )

    case .click, .setValue, .selectText, .secondaryAction, .scroll:
        return nil
    }
}

// MARK: - Waiting for the window server (§6.1)

/// How long the executor will wait for the window server to agree with a
/// geometry write before answering anyway.
///
/// It is not a `limits` field for the reason `hostSettlePollMs` is not: the host
/// neither enforces it nor reasons about it, and §2's rule is about bounds the
/// host would otherwise hardcode. What it is is a bound on this executor's own
/// wall time, and it is set from the measurement rather than from a round number.
///
/// Measured on macOS 26.5, one `AXPosition` write per row, polling the window
/// list at 5 ms until it reported the new origin:
///
/// | application | `AXPosition` readback | window server agreed |
/// | --- | --- | --- |
/// | Calculator | 11 ms | 26 ms |
/// | TextEdit | 4 ms | 38 ms |
/// | Google Chrome | 15 ms | 106 ms |
/// | Visual Studio Code | 3 ms | 112 ms |
/// | Obsidian | 16 ms | 172 ms |
///
/// 1000 ms is 5.8× the slowest of those, and it is a ceiling rather than a wait:
/// every one of those rows returns as soon as the list agrees.
let hostWindowServerAgreementCeilingMs = 1000

/// 5 ms, because the shortest thing being waited for is 26 ms and a 50 ms poll —
/// what settling uses — would round every AppKit window up to 50.
let hostWindowServerPollMs = 5

/// §6.1 — a geometry write is not finished when the application acknowledges it.
///
/// The application answers `AXPosition` from its own idea of the window
/// immediately; the window server finds out afterwards. Measured above at 26 ms
/// for Calculator and 172 ms for Obsidian, and *everything else in this executor
/// reads the window server*: `observe` resolves the target out of
/// `CGWindowListCopyWindowInfo`, and `HostAX.window(pid:windowId:bounds:)` then
/// matches the AX window against that frame to within one point, because there is
/// no public AX attribute carrying a `CGWindowID`.
///
/// So an executor that returned the instant the write was acknowledged would hand
/// back a result whose own `observeAfter` cannot find the window: the list still
/// reports the old frame, the application already reports the new one, they
/// differ by however far the window moved, no candidate matches, and the answer
/// is `window_gone` for a window sitting in plain sight. The host's next
/// `observe` would race the same way.
///
/// Returning `false` is not an error. It means the executor waited and the two
/// still disagree, which is a fact about the machine and not about the request —
/// the dispatch's own verdict comes from the `AXPosition` readback either way,
/// and a post-observation that then fails says so through `postObservationError`
/// exactly as §6.1 requires.
@discardableResult
func hostAwaitWindowServerAgreement(
    ceilingMs: Int,
    pollMs: Int,
    readback: String?,
    subject: HostWindowSubject,
    sample: () -> CGRect?,
    now: () -> Date = Date.init,
    sleep: (TimeInterval) -> Void = { Thread.sleep(forTimeInterval: $0) }
) -> Bool {
    let started = now()
    let budget = Double(ceilingMs) / 1000
    let poll = Double(pollMs) / 1000

    while true {
        if subject.serverAgrees(sample(), readback) {
            return true
        }

        guard now().timeIntervalSince(started) + poll < budget else {
            return false
        }

        sleep(poll)
    }
}
