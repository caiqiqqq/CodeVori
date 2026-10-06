import AppKit
import CoreGraphics
import CryptoKit
import Foundation
import ScreenCaptureKit

/// §8 — every image is a file path. There is no size threshold and no inline
/// branch: base64 on a line-delimited channel is a 4/3 blow-up that stalls every
/// other pending response while one 8 MB line is written.
public final class HostImageStore {
    public let directory: URL
    private let budgetBytes: Int
    private let fileManager = FileManager.default
    private let lock = NSLock()
    private var counter = 0

    public init(directory: URL, budgetBytes: Int) {
        self.directory = directory
        self.budgetBytes = budgetBytes
    }

    /// §2 — writability is verified during the handshake. Discovering the
    /// directory is read-only at the first `observe` would turn a configuration
    /// error into a capture failure.
    public func verifyWritable() throws {
        var isDirectory: ObjCBool = false
        guard fileManager.fileExists(atPath: directory.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            throw HostRPCError.invalidParams("imageDir")
        }

        let probe = directory.appendingPathComponent(".maka-cu-write-probe")
        guard fileManager.createFile(atPath: probe.path, contents: Data([0x6F, 0x6B])) else {
            throw HostRPCError.invalidParams("imageDir")
        }

        try? fileManager.removeItem(at: probe)
    }

    public func delete(path: String) {
        // Only files this store owns may be removed; the host addresses images by
        // the path it was given, and a path from anywhere else is not ours.
        guard URL(fileURLWithPath: path).deletingLastPathComponent().standardizedFileURL == directory.standardizedFileURL else {
            return
        }

        try? fileManager.removeItem(atPath: path)
    }

    /// Writes a PNG and returns the reference the wire carries. `scale` is
    /// measured from the image actually captured, never read off
    /// `NSScreen.backingScaleFactor`, because the two disagree on scaled displays
    /// and a wrong scale lands a click a quarter of the way into a control.
    public func writePNG(
        _ image: CGImage,
        namePrefix: String,
        logicalWidth: CGFloat
    ) -> Result<HostImageReference, HostDomainError> {
        guard let data = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else {
            return .failure(HostDomainError(.imageWriteFailed))
        }

        lock.lock()
        counter += 1
        let name = "\(namePrefix)_\(counter).png"
        lock.unlock()

        let url = directory.appendingPathComponent(name)

        if !makeRoom(for: data.count) {
            return .failure(HostDomainError(.imageWriteFailed))
        }

        do {
            try data.write(to: url, options: .atomic)
        } catch {
            return .failure(HostDomainError(.imageWriteFailed))
        }

        return .success(
            HostImageReference(
                path: url.path,
                format: .png,
                widthPx: image.width,
                heightPx: image.height,
                byteLength: data.count,
                sha256: HostDigest.sha256(data),
                scale: logicalWidth > 0 ? Double(image.width) / Double(logicalWidth) : 1
            )
        )
    }

    /// §8 — evict this store's oldest files first; report `image_write_failed`
    /// rather than silently returning a snapshot without the image asked for.
    private func makeRoom(for incoming: Int) -> Bool {
        guard incoming <= budgetBytes else {
            return false
        }

        var entries = ownedFiles()
        var total = entries.reduce(0) { $0 + $1.size }

        while total + incoming > budgetBytes, !entries.isEmpty {
            let oldest = entries.removeFirst()
            try? fileManager.removeItem(at: oldest.url)
            total -= oldest.size
        }

        return total + incoming <= budgetBytes
    }

    private func ownedFiles() -> [(url: URL, size: Int, created: Date)] {
        let keys: [URLResourceKey] = [.fileSizeKey, .creationDateKey]
        let contents = (try? fileManager.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: keys,
            options: [.skipsHiddenFiles]
        )) ?? []

        return contents
            .compactMap { url in
                guard let values = try? url.resourceValues(forKeys: Set(keys)) else {
                    return nil
                }
                return (url, values.fileSize ?? 0, values.creationDate ?? .distantPast)
            }
            .sorted { $0.created < $1.created }
    }
}

/// `captureScope: "desktop"` captures through a whole-display filter, which puts
/// the image's origin at the display's while `image.scale` and the `image_px`
/// space both anchor at the window's. This is the crop that reconciles them: the
/// window's rectangle expressed relative to the display it sits on.
public func hostDesktopSourceRect(windowFrame: CGRect, displayFrame: CGRect) -> CGRect {
    CGRect(
        x: windowFrame.origin.x - displayFrame.origin.x,
        y: windowFrame.origin.y - displayFrame.origin.y,
        width: windowFrame.width,
        height: windowFrame.height
    )
}

/// `SCShareableContent.current` enumerates every window and every application on
/// the system, and `observe` was paying for that enumeration once per screenshot
/// to use exactly one window out of it. Measured on this machine it is 100 to
/// 285 ms — roughly half of what a window capture costs — and it is the half that
/// has nothing to do with the window being captured.
///
/// So it is kept, and every use of it is checked against the window server
/// before it is trusted. The check is the whole design: a stale `SCWindow`
/// carries a stale `frame`, `SCContentFilter.contentRect` is derived from it, and
/// `HostCapture` sizes its output buffer from that rectangle — so a cache that
/// merely aged out on a timer would, inside its window, hand back an image of the
/// wrong size declaring the wrong `scale`. That is the defect §5.3 was written
/// after. Comparing the cached frame against `CGWindowListCopyWindowInfo` costs
/// one window-server call for one window id and makes the failure unreachable
/// rather than unlikely.
enum HostShareableContentCache {
    nonisolated(unsafe) private static var cached: SCShareableContent?

    /// Content that is known to describe `windowId` as the window server
    /// describes it right now, refetched when it does not.
    static func content(matching windowId: CGWindowID) async throws -> SCShareableContent {
        if let cached, isCurrent(cached, windowId: windowId) {
            return cached
        }

        let fresh = try await SCShareableContent.current
        cached = fresh
        return fresh
    }

    /// Content whose record of `displayId` matches the display list right now.
    static func content(matchingDisplay displayId: CGDirectDisplayID) async throws -> SCShareableContent {
        if let cached, let display = cached.displays.first(where: { $0.displayID == displayId }),
            display.frame == CGDisplayBounds(displayId) {
            return cached
        }

        let fresh = try await SCShareableContent.current
        cached = fresh
        return fresh
    }

    /// Dropped whenever something is known to have changed underneath it, so the
    /// next capture pays for a fetch instead of discovering the staleness.
    static func invalidate() {
        cached = nil
    }

    private static func isCurrent(_ content: SCShareableContent, windowId: CGWindowID) -> Bool {
        guard
            let window = content.windows.first(where: { $0.windowID == windowId }),
            let live = liveFrame(of: windowId)
        else {
            return false
        }

        // Whole points. `SCWindow.frame` and `CGWindowListCopyWindowInfo` are the
        // same space (§5.3) but disagree in the sub-pixel digits on scaled
        // displays, which is the same tolerance `HostAX.window` matches on.
        return abs(window.frame.origin.x - live.origin.x) < 1
            && abs(window.frame.origin.y - live.origin.y) < 1
            && abs(window.frame.width - live.width) < 1
            && abs(window.frame.height - live.height) < 1
    }

    private static func liveFrame(of windowId: CGWindowID) -> CGRect? {
        guard
            let info = CGWindowListCopyWindowInfo([.optionIncludingWindow], windowId) as? [[String: Any]],
            let bounds = info.first?[kCGWindowBounds as String] as? NSDictionary
        else {
            return nil
        }

        return CGRect(dictionaryRepresentation: bounds)
    }
}

public enum HostCapture {
    static let timeout: TimeInterval = 5

    /// The one place an output buffer is sized, because there is only one way to
    /// size it correctly. `SCStreamConfiguration.width` / `.height` are **pixels**;
    /// the region ScreenCaptureKit draws into them is **points**. The conversion
    /// between the two spaces is `SCContentFilter.pointPixelScale`, and it has to
    /// be the filter's own, because that is the number the compositor will use
    /// when it renders.
    ///
    /// Deriving it from `NSScreen` instead is what produced a quarter-drawn
    /// window: `NSScreen.frame` is AppKit's y-up space and `SCWindow.frame` is
    /// CoreGraphics' y-down space, so `intersects` never matched for a window on
    /// a display above the main one and the code fell back to
    /// `NSScreen.main.backingScaleFactor`. A 674 × 408 pt window on a 1x external
    /// display was given a 1348 × 816 px buffer; ScreenCaptureKit does not
    /// stretch content to fill an oversized buffer, it anchors it at the top-left
    /// and leaves the rest transparent. 25% of the image was the window,
    /// declaring `scale: 2.0` over content rendered at 1.0.
    private static func sizeToContent(
        _ configuration: SCStreamConfiguration,
        filter: SCContentFilter,
        regionPoints: CGSize
    ) {
        let scale = CGFloat(filter.pointPixelScale)
        configuration.width = max(1, Int((regionPoints.width * scale).rounded()))
        configuration.height = max(1, Int((regionPoints.height * scale).rounded()))
    }

    /// Window capture through ScreenCaptureKit. `capture_failed` and `timeout` are
    /// separate results because a timed-out capture means the compositor is busy
    /// and a retry is reasonable, while a failed one usually means the window went
    /// away.
    public static func captureWindow(windowId: CGWindowID, scope: HostCaptureScope) -> Result<CGImage, HostDomainError> {
        do {
            let image = try BlockingAsyncBridge.run(timeout: timeout) {
                let content = try await HostShareableContentCache.content(matching: windowId)
                guard let window = content.windows.first(where: { $0.windowID == windowId }) else {
                    return CGImage?.none
                }

                let configuration = SCStreamConfiguration()
                configuration.showsCursor = false
                // Kept off deliberately. With the buffer sized off the filter the
                // two can no longer disagree, and if some future change makes
                // them disagree again, a transparent margin is a defect anyone
                // can see, while a stretch is an invented `scale` that reads as
                // correct on the wire.
                configuration.scalesToFit = false
                configuration.ignoreShadowsSingleWindow = true

                let filter: SCContentFilter
                switch scope {
                case .window:
                    filter = SCContentFilter(desktopIndependentWindow: window)
                    sizeToContent(configuration, filter: filter, regionPoints: filter.contentRect.size)
                case .desktop:
                    guard let display = content.displays.first(where: { $0.frame.intersects(window.frame) }) ?? content.displays.first else {
                        return CGImage?.none
                    }
                    filter = SCContentFilter(display: display, excludingWindows: [])
                    // §5.3 / §6.3 — `image.scale` is measured against the target
                    // window and `dispatch.point` reads `image_px` from the
                    // window's origin, so a desktop-scope image has to be the
                    // window's rectangle *as composited* — everything stacked on
                    // top included. Handing back a display-origin crop the size of
                    // the window kept both fields but moved the pixels, and every
                    // point dispatch under this scope landed somewhere else.
                    let sourceRect = hostDesktopSourceRect(
                        windowFrame: window.frame,
                        displayFrame: display.frame
                    )
                    configuration.sourceRect = sourceRect
                    // The cropped region, not the whole display: the buffer holds
                    // the window's rectangle and nothing else.
                    sizeToContent(configuration, filter: filter, regionPoints: sourceRect.size)
                }

                return try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
            }

            guard let image else {
                return .failure(HostDomainError(.captureFailed))
            }

            return .success(image)
        } catch {
            return .failure(HostDomainError(.timeout))
        }
    }

    public static func captureDisplay(displayId: CGDirectDisplayID) -> Result<CGImage, HostDomainError> {
        do {
            let image = try BlockingAsyncBridge.run(timeout: timeout) {
                let content = try await HostShareableContentCache.content(matchingDisplay: displayId)
                guard let display = content.displays.first(where: { $0.displayID == displayId }) else {
                    return CGImage?.none
                }

                let configuration = SCStreamConfiguration()
                configuration.showsCursor = false
                let filter = SCContentFilter(display: display, excludingWindows: [])
                // `SCDisplay.width` / `.height` are points, and they were being
                // assigned to a field that is pixels. The compositor absorbed it
                // by downscaling — the image filled, so nothing looked broken —
                // but a Retina display came back at half its resolution
                // declaring `scale: 1.0`, which is not the frame §6.6 documents.
                sizeToContent(configuration, filter: filter, regionPoints: filter.contentRect.size)

                return try await SCScreenshotManager.captureImage(
                    contentFilter: filter,
                    configuration: configuration
                )
            }

            guard let image else {
                return .failure(HostDomainError(.captureFailed))
            }

            return .success(image)
        } catch {
            return .failure(HostDomainError(.timeout))
        }
    }
}
