// swift-tools-version: 5.10

import PackageDescription

let package = Package(
    name: "OpenZCodeComputerUseNative",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "OpenZCodeNative", targets: ["OpenZCodeNative"]),
        .executable(name: "OpenZCodeFixture", targets: ["OpenZCodeFixture"]),
    ],
    targets: [
        .testTarget(
            name: "OpenComputerUseKitTests",
            dependencies: ["OpenComputerUseKit"],
            path: "Tests/OpenComputerUseKitTests"
        ),
        .target(
            name: "OpenComputerUseKit",
            path: "Sources/OpenComputerUseKit"
        ),
        .executableTarget(
            name: "OpenZCodeNative",
            dependencies: ["OpenComputerUseKit"],
            path: "Sources/OpenZCodeNative"
        ),
        .executableTarget(
            name: "OpenZCodeFixture",
            dependencies: ["OpenComputerUseKit"],
            path: "Sources/OpenZCodeFixture"
        ),
    ]
)
