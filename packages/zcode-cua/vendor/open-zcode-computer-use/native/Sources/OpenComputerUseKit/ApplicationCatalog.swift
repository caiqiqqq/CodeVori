import AppKit
import Foundation

public func hostResolveApplicationBundle(_ query: String) throws -> String {
    let url = try ApplicationCatalog.resolve(query)
    guard let identifier = Bundle(url: url)?.bundleIdentifier else {
        throw ComputerUseError.appNotFound(query)
    }
    return identifier
}

/// 应用名称由原生目录统一解析，避免中文名称落入同名的虚拟机快捷方式。
enum ApplicationCatalog {
    static let roots: [URL] = [
        URL(fileURLWithPath: "/System/Applications", isDirectory: true),
        URL(fileURLWithPath: "/System/Library/CoreServices", isDirectory: true),
        URL(fileURLWithPath: "/Applications", isDirectory: true),
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications", isDirectory: true),
    ]

    static func isBundleIdentifier(_ query: String) -> Bool {
        query.contains(".") && !query.lowercased().hasSuffix(".app") && !query.contains("/")
    }

    static func nameWithoutSuffix(_ name: String) -> String {
        name.lowercased().hasSuffix(".app") ? String(name.dropLast(4)) : name
    }

    static func matches(_ url: URL, name: String) -> Bool {
        let wanted = nameWithoutSuffix(name).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !wanted.isEmpty else { return false }
        func equal(_ candidate: String?) -> Bool {
            candidate.map { nameWithoutSuffix($0).caseInsensitiveCompare(wanted) == .orderedSame } ?? false
        }
        if equal(url.lastPathComponent) || equal(FileManager.default.displayName(atPath: url.path)) {
            return true
        }
        guard let bundle = Bundle(url: url) else { return false }
        let keys = ["CFBundleDisplayName", "CFBundleName"]
        if keys.contains(where: { equal(bundle.object(forInfoDictionaryKey: $0) as? String) }) {
            return true
        }
        // 新版 macOS 把系统应用的本地化字典集中到 loctable；独立命令行进程默认读英文。
        if let url = bundle.url(forResource: "InfoPlist", withExtension: "loctable"),
           let data = try? Data(contentsOf: url),
           let locales = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any] {
            for case let names as [String: Any] in locales.values {
                if keys.contains(where: { equal(names[$0] as? String) }) { return true }
            }
        }
        // 当前进程的首选语言可能与用户输入不同；按 bundle 已声明的本地化名称精确匹配。
        for locale in bundle.localizations {
            guard let path = bundle.path(forResource: "InfoPlist", ofType: "strings", inDirectory: nil, forLocalization: locale),
                  let data = try? Data(contentsOf: URL(fileURLWithPath: path)),
                  let names = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any]
            else { continue }
            if keys.contains(where: { equal(names[$0] as? String) }) { return true }
        }
        return false
    }

    static func applicationURL(named name: String, roots: [URL] = roots) -> URL? {
        for root in roots {
            guard let entries = FileManager.default.enumerator(
                at: root, includingPropertiesForKeys: [.isApplicationKey],
                options: [.skipsHiddenFiles, .skipsPackageDescendants]
            ) else { continue }
            for case let url as URL in entries {
                if url.pathExtension.lowercased() == "app", matches(url, name: name) {
                    return url
                }
            }
        }
        return nil
    }

    static func resolve(_ query: String) throws -> URL {
        let name = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let url = isBundleIdentifier(name)
            ? NSWorkspace.shared.urlForApplication(withBundleIdentifier: name)
            : applicationURL(named: name)
        guard let url else { throw ComputerUseError.appNotFound(name) }
        let identifier = Bundle(url: url)?.bundleIdentifier
        if AppSafetyPolicy.isBlocked(bundleIdentifier: identifier) {
            throw AppSafetyPolicy.permissionDenied(bundleIdentifier: identifier ?? name)
        }
        return url
    }
}
