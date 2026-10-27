import CoreGraphics
import XCTest
@testable import OpenComputerUseKit

final class WebContentBindingTests: XCTestCase {
    private func binding(token: String, ancestors: [String], dispatchPid: Int32 = 42) -> HostElementBinding {
        let frame = CGRect(x: 20, y: 40, width: 120, height: 24)
        let digest = HostElementDigestInput(role: "AXTextField", label: "Input", frameInWindow: frame, ancestorRoles: ancestors)
        let observed = HostObservedElement(
            token: token, stableId: nil, parentToken: nil, depth: 2,
            role: "AXTextField", subrole: nil, axIdentifier: nil, title: nil,
            label: "Input", value: nil, placeholder: nil, enabled: true,
            focused: true, selected: nil, frame: HostRect(frame), actions: [],
            digest: hostElementDigest(digest), truncated: []
        )
        return HostElementBinding(token: token, parentToken: nil, depth: 2, pid: 42,
            processStartTime: 1, dispatchPid: dispatchPid, dispatchProcessStartTime: 1,
            digestInput: digest, element: nil, observed: observed)
    }

    func testChromiumControlIsNotItsOwnWebKitMirror() {
        let control = binding(token: "input", ancestors: ["AXGroup", "AXWebArea"])
        XCTAssertFalse(hostIsWebContentEquivalent(recorded: control, candidate: control))
    }

    func testNativeMirrorCanStillPromoteToRenderer() {
        let mirror = binding(token: "mirror", ancestors: ["AXGroup", "AXWindow"])
        let renderer = binding(token: "renderer", ancestors: ["AXGroup", "AXWebArea"], dispatchPid: 43)
        XCTAssertTrue(hostIsWebContentEquivalent(recorded: mirror, candidate: renderer))
        XCTAssertFalse(hostIsWebContentEquivalent(recorded: renderer, candidate: mirror))
    }
}
