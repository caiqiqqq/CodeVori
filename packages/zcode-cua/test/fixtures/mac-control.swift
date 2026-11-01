import AppKit

@MainActor final class FixtureDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    let label = NSTextField(labelWithString: "Counter: 0")
    let field = NSTextField(string: "seed")
    var count = 0
    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 120, y: 180, width: 420, height: 220), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "CodeVori Native Test Fixture"
        field.frame = NSRect(x: 30, y: 120, width: 350, height: 30)
        field.setAccessibilityLabel("Fixture Input")
        label.frame = NSRect(x: 30, y: 40, width: 180, height: 24)
        let button = NSButton(title: "Increment", target: self, action: #selector(increment))
        button.frame = NSRect(x: 240, y: 40, width: 130, height: 32)
        for view in [field, label, button] { window.contentView!.addSubview(view) }
        let menu = NSMenu()
        let appItem = NSMenuItem(title: "Fixture", action: nil, keyEquivalent: "")
        let appMenu = NSMenu(title: "Fixture")
        appMenu.addItem(NSMenuItem(title: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        menu.addItem(appItem)
        menu.setSubmenu(appMenu, for: appItem)
        let editItem = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(NSMenuItem(title: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"))
        editMenu.addItem(NSMenuItem(title: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v"))
        menu.addItem(editItem)
        menu.setSubmenu(editMenu, for: editItem)
        NSApp.mainMenu = menu
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
    @objc func increment() { count += 1; label.stringValue = "Counter: \(count)" }
}
@main struct FixtureMain {
    @MainActor static func main() {
        let app = NSApplication.shared
        let delegate = FixtureDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
        withExtendedLifetime(delegate) {}
    }
}
