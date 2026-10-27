import Foundation
import XCTest
@testable import OpenComputerUseKit

final class ApplicationCatalogTests: XCTestCase {
    func testLocalizedSystemNamesAndAppSuffixes() throws {
        for (name, identifier) in [
            ("文本编辑", "com.apple.TextEdit"),
            ("文本编辑.app", "com.apple.TextEdit"),
            ("TextEdit.app", "com.apple.TextEdit"),
            ("计算器", "com.apple.calculator"),
            ("com.apple.calculator", "com.apple.calculator"),
        ] {
            XCTAssertEqual(try hostResolveApplicationBundle(name), identifier, name)
        }
        XCTAssertFalse(ApplicationCatalog.isBundleIdentifier("TextEdit.app"))
        XCTAssertFalse(ApplicationCatalog.isBundleIdentifier("Example.APP"))
    }

    func testSystemNameWinsOverVirtualMachineShim() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let shim = root.appendingPathComponent("计算器.app/Contents")
        try FileManager.default.createDirectory(at: shim, withIntermediateDirectories: true)
        let data = try PropertyListSerialization.data(
            fromPropertyList: ["CFBundleIdentifier": "com.parallels.winapp.fixture", "CFBundleName": "计算器"],
            format: .xml, options: 0
        )
        try data.write(to: shim.appendingPathComponent("Info.plist"))
        let result = ApplicationCatalog.applicationURL(named: "计算器", roots: [ApplicationCatalog.roots[0], root])
        XCTAssertEqual(result.flatMap { Bundle(url: $0)?.bundleIdentifier }, "com.apple.calculator")
        XCTAssertNil(ApplicationCatalog.applicationURL(named: "Unknown Application \(UUID())", roots: [root]))
    }

    func testLoctableNamesAreIndependentOfProcessLanguage() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let contents = root.appendingPathComponent("CatalogFixture.app/Contents")
        let resources = contents.appendingPathComponent("Resources")
        try FileManager.default.createDirectory(at: resources, withIntermediateDirectories: true)
        let info = try PropertyListSerialization.data(
            fromPropertyList: ["CFBundleIdentifier": "dev.zcode.catalog.fixture", "CFBundleName": "CatalogFixture"],
            format: .xml, options: 0
        )
        try info.write(to: contents.appendingPathComponent("Info.plist"))
        let translations = [
            "zh_CN": ["CFBundleDisplayName": "目录测试中文"],
            "fr": ["CFBundleDisplayName": "Catalogue exemple"],
        ]
        let table = try PropertyListSerialization.data(fromPropertyList: translations, format: .binary, options: 0)
        try table.write(to: resources.appendingPathComponent("InfoPlist.loctable"))
        for name in ["目录测试中文", "Catalogue exemple", "CatalogFixture.APP"] {
            XCTAssertEqual(ApplicationCatalog.applicationURL(named: name, roots: [root])?.lastPathComponent, "CatalogFixture.app")
        }
    }
}
