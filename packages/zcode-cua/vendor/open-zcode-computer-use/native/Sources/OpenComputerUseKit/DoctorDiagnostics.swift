import Darwin
import Foundation
import Security

public struct DoctorDiagnostics: Codable, Equatable, Sendable {
    public struct Executor: Codable, Equatable, Sendable {
        public let name: String
        public let version: String
        public let buildCommit: String
        public let protocolVersion: String
    }

    public struct Platform: Codable, Equatable, Sendable {
        public let operatingSystem: String
        public let architecture: String
    }

    public struct Permissions: Codable, Equatable, Sendable {
        public let accessibility: Bool
        public let screenRecording: Bool

        public var allGranted: Bool {
            accessibility && screenRecording
        }
    }

    public struct NativeCapabilities: Codable, Equatable, Sendable {
        public let skyLightAvailable: Bool
        public let skyLightMissingSymbols: [String]
        public let actualPidSPIAvailable: Bool
        public let coalitionProbeAvailable: Bool
    }

    public struct Signature: Codable, Equatable, Sendable {
        public let kind: String
        public let identifier: String?
        public let teamIdentifier: String?
        public let hardenedRuntime: Bool
    }

    public struct Readiness: Codable, Equatable, Sendable {
        public let hostProtocol: Bool
        public let metadataObservation: Bool
        public let screenshotObservation: Bool
        public let trustedWebContentClick: Bool
    }

    public let schemaVersion: Int
    public let executor: Executor
    public let platform: Platform
    public let permissions: Permissions
    public let screenLocked: Bool
    public let nativeCapabilities: NativeCapabilities
    public let signature: Signature
    public let readiness: Readiness
    public let executablePath: String

    public static func current() -> DoctorDiagnostics {
        let skyLight = SkyLightSPI.shared.capability
        return make(
            permissionDiagnostics: .current(),
            screenLocked: hostScreenIsLocked(),
            skyLightAvailable: skyLight.isAvailable,
            skyLightMissingSymbols: skyLight.missingSymbols,
            actualPidSPIAvailable: hostActualPidSPIAvailable(),
            coalitionProbeAvailable: LiveApplicationInventory.coalitionProbeAvailable(),
            signature: currentCodeSignature(),
            executablePath: URL(
                fileURLWithPath: CommandLine.arguments[0]
            ).standardizedFileURL.path,
            version: resolvedOpenComputerUseVersion(),
            buildCommit: openComputerUseBuildCommit()
        )
    }

    static func make(
        permissionDiagnostics: PermissionDiagnostics,
        screenLocked: Bool,
        skyLightAvailable: Bool,
        skyLightMissingSymbols: [String],
        actualPidSPIAvailable: Bool,
        coalitionProbeAvailable: Bool,
        signature: Signature,
        executablePath: String,
        version: String,
        buildCommit: String
    ) -> DoctorDiagnostics {
        let permissions = Permissions(
            accessibility: permissionDiagnostics.accessibilityTrusted,
            screenRecording: permissionDiagnostics.screenCaptureGranted
        )
        let native = NativeCapabilities(
            skyLightAvailable: skyLightAvailable,
            skyLightMissingSymbols: skyLightMissingSymbols,
            actualPidSPIAvailable: actualPidSPIAvailable,
            coalitionProbeAvailable: coalitionProbeAvailable
        )
        let unlocked = !screenLocked
        return DoctorDiagnostics(
            schemaVersion: 1,
            executor: Executor(
                name: "maka-cu",
                version: version,
                buildCommit: buildCommit,
                protocolVersion: makaCuProtocolVersion
            ),
            platform: Platform(
                operatingSystem: "macOS",
                architecture: currentArchitecture()
            ),
            permissions: permissions,
            screenLocked: screenLocked,
            nativeCapabilities: native,
            signature: signature,
            readiness: Readiness(
                hostProtocol: true,
                metadataObservation: unlocked && permissions.accessibility,
                screenshotObservation: unlocked && permissions.allGranted,
                trustedWebContentClick: unlocked
                    && permissions.accessibility
                    && native.skyLightAvailable
                    && native.actualPidSPIAvailable
                    && native.coalitionProbeAvailable
            ),
            executablePath: executablePath
        )
    }

    public func encodedJSON() throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return String(decoding: try encoder.encode(self), as: UTF8.self)
    }

    public var renderedText: String {
        [
            "maka-cu doctor",
            "  executor: \(executor.version) (\(executor.buildCommit)), protocol=\(executor.protocolVersion)",
            "  platform: \(platform.operatingSystem) \(platform.architecture)",
            "  permissions: accessibility=\(status(permissions.accessibility)), screenRecording=\(status(permissions.screenRecording))",
            "  session: screenLocked=\(screenLocked)",
            "  native: skyLight=\(status(nativeCapabilities.skyLightAvailable)), actualPidSPI=\(status(nativeCapabilities.actualPidSPIAvailable)), coalitionProbe=\(status(nativeCapabilities.coalitionProbeAvailable))",
            "  signature: \(signature.kind), hardenedRuntime=\(signature.hardenedRuntime), team=\(signature.teamIdentifier ?? "none")",
            "  ready: metadata=\(readiness.metadataObservation), screenshot=\(readiness.screenshotObservation), trustedWebContentClick=\(readiness.trustedWebContentClick)",
            "  executable: \(executablePath)",
        ].joined(separator: "\n")
    }

    private func status(_ value: Bool) -> String {
        value ? "available" : "unavailable"
    }
}

private func currentArchitecture() -> String {
    var info = utsname()
    uname(&info)
    var machine = info.machine
    let capacity = MemoryLayout.size(ofValue: machine)
    return withUnsafePointer(to: &machine) { pointer in
        pointer.withMemoryRebound(to: CChar.self, capacity: capacity) {
            String(cString: $0)
        }
    }
}

private func currentCodeSignature() -> DoctorDiagnostics.Signature {
    let executableURL = Bundle.main.executableURL
        ?? URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL
    var code: SecStaticCode?
    guard SecStaticCodeCreateWithPath(executableURL as CFURL, [], &code) == errSecSuccess,
          let code
    else {
        return DoctorDiagnostics.Signature(
            kind: "none",
            identifier: nil,
            teamIdentifier: nil,
            hardenedRuntime: false
        )
    }

    var information: CFDictionary?
    guard SecCodeCopySigningInformation(code, SecCSFlags(rawValue: kSecCSSigningInformation), &information) == errSecSuccess,
          let values = information as? [CFString: Any]
    else {
        return DoctorDiagnostics.Signature(
            kind: "none",
            identifier: nil,
            teamIdentifier: nil,
            hardenedRuntime: false
        )
    }

    let flags = (values[kSecCodeInfoFlags] as? NSNumber)?.uint32Value ?? 0
    // Security/CSCommon.h: kSecCodeSignatureAdhoc and
    // kSecCodeSignatureRuntime are not imported into Swift.
    let adhoc = flags & 0x0002 != 0
    let hardenedRuntime = flags & 0x10000 != 0
    let teamIdentifier = values[kSecCodeInfoTeamIdentifier] as? String
    let kind: String
    if adhoc {
        kind = "adhoc"
    } else if teamIdentifier != nil {
        kind = "signed"
    } else {
        kind = "linker-or-unsigned"
    }

    return DoctorDiagnostics.Signature(
        kind: kind,
        identifier: values[kSecCodeInfoIdentifier] as? String,
        teamIdentifier: teamIdentifier,
        hardenedRuntime: hardenedRuntime
    )
}
