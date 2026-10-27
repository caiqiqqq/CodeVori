import Foundation
import XCTest
@testable import OpenComputerUseKit

final class ValueReadbackTests: XCTestCase {
    func testEmptyStringIsReadableAndDistinctFromMissingValue() {
        XCTAssertEqual(HostAX.stringLikeValue("" as CFString), "")
        XCTAssertNil(HostAX.stringLikeValue(NSNull()))
        XCTAssertEqual(hostEffectFromValueReadback(requested: "", previous: "seed", readback: "").effect, .confirmed)
        XCTAssertEqual(hostEffectFromValueReadback(requested: "", previous: "seed", readback: nil).effect, .unverifiable)
    }

    func testDelayedEmptyReadbackWaitsWithoutReplayingWrite() {
        var now = 0.0
        var reads = 0
        let value = hostAwaitValueReadback(requested: "", previous: "seed", sample: {
            reads += 1
            return reads < 3 ? "seed" : ""
        }, now: { now }, sleep: { now += $0 })
        XCTAssertEqual(value, "")
        XCTAssertEqual(reads, 3)
        XCTAssertEqual(now, 0.1, accuracy: 0.001)
    }

    func testNoAcknowledgementHasABoundedBudgetAndThirdValueStopsWaiting() {
        var now = 0.0
        let value = hostAwaitValueReadback(requested: "", previous: "seed", sample: { "seed" }, now: { now }, sleep: { now += $0 })
        XCTAssertEqual(value, "seed")
        XCTAssertLessThanOrEqual(now, 0.251)
        XCTAssertEqual(hostAwaitValueReadback(requested: "", previous: "seed", sample: { "external edit" }, sleep: { _ in XCTFail("must not wait on a third-party change") }), "external edit")
    }
}
