import Carbon.HIToolbox
import CoreGraphics
import Foundation

/// §6.4 — the closed key set, and the one place it is resolved.
///
/// The set has 120 members and no more: the 26 named keys below, and the 94
/// printable characters U+0021–U+007E. It is small enough to write down, so it
/// is written down, and both ends read this table — the decoder that answers
/// `-32602` to anything outside the set, and the dispatcher that posts what is
/// inside it. A key the wire advertises and the dispatcher cannot build is the
/// defect two separate copies produce, and §12 vector 54 is the assertion that
/// the two sets are one set.
///
/// ## Why a table and not `UCKeyTranslate`
///
/// The event has to carry **characters**, set by the executor. A key code is
/// half an event; what an application acts on is the character, and an
/// application that is not frontmost does not supply the missing half for
/// itself. Measured, one key press per row, against a background TextEdit (§14):
/// `dispatch.key` with `kind: "key"` did nothing at all until the string was
/// set, which is the whole of the difference between it and `type`.
///
/// Which leaves the question of where the characters come from, and the live
/// keyboard layout is the wrong answer three times over:
///
/// - **It is global mutable state.** `UCKeyTranslate` reads whatever input
///   source the user has selected, which they may change between two dispatches
///   of one turn. A protocol whose every other answer is reproducible does not
///   get to have one answer that depends on the menu bar.
/// - **It does not have the answer.** Measured against the current input source,
///   the key code alone translates to the wrong character for 22 of the 26 named
///   keys: U+001D for the right arrow where AppKit binds U+F703, U+007F for
///   `ForwardDelete` — which is the *backspace* key's character, so the layout
///   would have deleted in the wrong direction — and one shared U+0010 for all
///   twelve function keys. The private-use codes below are AppKit's, and no
///   keyboard layout produces them.
/// - **It is stateful.** `UCKeyTranslate` carries a dead-key state, and a
///   translation that returns nothing while arming the next one makes a key
///   press depend on the key press before it.
///
/// What the table gives up is the *virtual key code* on a non-US layout: the
/// codes below are ANSI positions, so on a Dvorak or AZERTY layout the code
/// names a different physical key than the character says. That costs nothing
/// where it matters — the application acts on the character — and it is the
/// price of an answer that does not move when the user switches input source.
public struct HostKeyStroke: Equatable, Sendable {
    public let keyCode: CGKeyCode
    public let flags: CGEventFlags
    /// UTF-16 units, as `CGEvent.keyboardSetUnicodeString` takes them. Never
    /// empty: a key that produces no character is not in the closed set.
    public let characters: [UniChar]

    /// Whether the posted event actually carries them, and the one case where it
    /// must not.
    ///
    /// A `command`-modified key is how macOS spells a menu command, and
    /// `performKeyEquivalent:` matches it against the application's own
    /// translation of the key code. An event that arrives with characters
    /// already on it is taken as text and is never offered to that path, so
    /// setting them does not improve a shortcut — it deletes it. Measured
    /// against a TextEdit document, resetting the selection through
    /// Accessibility between rows so no row can read as the one before it:
    ///
    /// ```
    ///                    frontmost                background
    /// cmd+a   plain      loc 0 → len 34           no effect
    /// cmd+a   + "a"      no effect                no effect
    /// cmd+←   plain      loc 0 → 33               no effect
    /// cmd+←   + U+F703   loc 0 → 33               loc 0 → 33
    /// →       plain      loc 0 → 1                no effect
    /// →       + U+F703   loc 0 → 1                loc 0 → 1
    /// shift+→ + U+F703   —                        len 0 → 1
    /// opt+→   + U+F703   —                        loc 0 → 4
    /// ctrl+e  + "e"      —                        loc 0 → 33
    /// ```
    ///
    /// Read the rows together and the rule falls out: characters are what an
    /// application that is not frontmost needs in order to act on a key at all,
    /// and they are what a menu equivalent cannot survive. Every combination
    /// gains from them except `command`, which loses.
    ///
    /// What this leaves on the table is row four: `cmd+←` is a caret motion
    /// rather than a menu command, and it would reach a background application
    /// if the characters were there. The executor does not know which of the two
    /// a given `command` key is — `cmd+↓` is caret motion in a text view and
    /// *Open* in the Finder — and the two need opposite events, so it takes the
    /// one that costs nothing. §14 carries the question.
    public var carriesCharacters: Bool {
        !flags.contains(.maskCommand)
    }
}

/// The named keys, each with the character macOS puts on it.
///
/// §6.4 — `Enter` and `Delete` are deliberately absent. `Enter` was a second
/// name for `Return` with no stated difference; `Delete` is the legend on a Mac
/// backspace key and the *forward* delete in the xdotool vocabulary, so one
/// string named two destructive keys and the wire could not say which.
/// `Backspace` and `ForwardDelete` are the only spellings.
///
/// The characters are AppKit's: the control codes for the four that have one,
/// U+007F for the backspace key (`NSDeleteCharacter`, which is what that key
/// produces and not the U+0008 its name suggests), and the private-use function
/// codes `NSUpArrowFunctionKey`…`NSPageDownFunctionKey` for the rest. U+F703 for
/// `Right` is the one §14 measured directly.
private let hostNamedKeyStrokes: [String: (keyCode: CGKeyCode, character: UniChar)] = {
    var table: [String: (keyCode: CGKeyCode, character: UniChar)] = [
        "Return": (CGKeyCode(kVK_Return), 0x000D),
        "Tab": (CGKeyCode(kVK_Tab), 0x0009),
        "Space": (CGKeyCode(kVK_Space), 0x0020),
        "Escape": (CGKeyCode(kVK_Escape), 0x001B),
        "Backspace": (CGKeyCode(kVK_Delete), 0x007F),
        "ForwardDelete": (CGKeyCode(kVK_ForwardDelete), 0xF728),
        "Up": (CGKeyCode(kVK_UpArrow), 0xF700),
        "Down": (CGKeyCode(kVK_DownArrow), 0xF701),
        "Left": (CGKeyCode(kVK_LeftArrow), 0xF702),
        "Right": (CGKeyCode(kVK_RightArrow), 0xF703),
        "Home": (CGKeyCode(kVK_Home), 0xF729),
        "End": (CGKeyCode(kVK_End), 0xF72B),
        "PageUp": (CGKeyCode(kVK_PageUp), 0xF72C),
        "PageDown": (CGKeyCode(kVK_PageDown), 0xF72D),
    ]

    let functionKeyCodes = [
        kVK_F1, kVK_F2, kVK_F3, kVK_F4, kVK_F5, kVK_F6,
        kVK_F7, kVK_F8, kVK_F9, kVK_F10, kVK_F11, kVK_F12,
    ]
    for (offset, keyCode) in functionKeyCodes.enumerated() {
        // `NSF1FunctionKey` is 0xF704 and the twelve run consecutively.
        table["F\(offset + 1)"] = (CGKeyCode(keyCode), UniChar(0xF704 + offset))
    }

    return table
}()

/// The US ANSI layout, one row per physical key, unshifted and shifted.
///
/// 47 keys, 94 characters, which is exactly U+0021–U+007E — the range §6.4
/// declares. The space bar is not here because `Space` is its only spelling.
private let hostPrintableKeyRows: [(keyCode: Int, unshifted: Character, shifted: Character)] = [
    (kVK_ANSI_A, "a", "A"), (kVK_ANSI_B, "b", "B"), (kVK_ANSI_C, "c", "C"),
    (kVK_ANSI_D, "d", "D"), (kVK_ANSI_E, "e", "E"), (kVK_ANSI_F, "f", "F"),
    (kVK_ANSI_G, "g", "G"), (kVK_ANSI_H, "h", "H"), (kVK_ANSI_I, "i", "I"),
    (kVK_ANSI_J, "j", "J"), (kVK_ANSI_K, "k", "K"), (kVK_ANSI_L, "l", "L"),
    (kVK_ANSI_M, "m", "M"), (kVK_ANSI_N, "n", "N"), (kVK_ANSI_O, "o", "O"),
    (kVK_ANSI_P, "p", "P"), (kVK_ANSI_Q, "q", "Q"), (kVK_ANSI_R, "r", "R"),
    (kVK_ANSI_S, "s", "S"), (kVK_ANSI_T, "t", "T"), (kVK_ANSI_U, "u", "U"),
    (kVK_ANSI_V, "v", "V"), (kVK_ANSI_W, "w", "W"), (kVK_ANSI_X, "x", "X"),
    (kVK_ANSI_Y, "y", "Y"), (kVK_ANSI_Z, "z", "Z"),
    (kVK_ANSI_0, "0", ")"), (kVK_ANSI_1, "1", "!"), (kVK_ANSI_2, "2", "@"),
    (kVK_ANSI_3, "3", "#"), (kVK_ANSI_4, "4", "$"), (kVK_ANSI_5, "5", "%"),
    (kVK_ANSI_6, "6", "^"), (kVK_ANSI_7, "7", "&"), (kVK_ANSI_8, "8", "*"),
    (kVK_ANSI_9, "9", "("),
    (kVK_ANSI_Grave, "`", "~"), (kVK_ANSI_Minus, "-", "_"),
    (kVK_ANSI_Equal, "=", "+"), (kVK_ANSI_LeftBracket, "[", "{"),
    (kVK_ANSI_RightBracket, "]", "}"), (kVK_ANSI_Backslash, "\\", "|"),
    (kVK_ANSI_Semicolon, ";", ":"), (kVK_ANSI_Quote, "'", "\""),
    (kVK_ANSI_Comma, ",", "<"), (kVK_ANSI_Period, ".", ">"),
    (kVK_ANSI_Slash, "/", "?"),
]

/// Every printable character, mapped to the key that carries it and to what that
/// key produces with shift held. A character that is already a shifted form maps
/// to itself, so `shift` is idempotent rather than a second translation.
private let hostPrintableKeys: [Character: (keyCode: CGKeyCode, shifted: Character)] = {
    var table: [Character: (keyCode: CGKeyCode, shifted: Character)] = [:]
    for row in hostPrintableKeyRows {
        table[row.unshifted] = (CGKeyCode(row.keyCode), row.shifted)
        table[row.shifted] = (CGKeyCode(row.keyCode), row.shifted)
    }
    return table
}()

/// The named keys the executor will accept, plus single printable characters.
/// Derived from the table it is dispatched from, so the set the wire advertises
/// and the set the executor can post are the same set by construction.
public let hostNamedKeys: Set<String> = Set(hostNamedKeyStrokes.keys)

public func hostKeyNameIsSupported(_ name: String) -> Bool {
    hostKeyStroke(name: name, modifiers: []) != nil
}

/// §6.4 — one wire key and its declared modifiers, resolved to a postable event.
/// `nil` for anything outside the closed set, which is `-32602`: the host parses,
/// so an unparseable key arriving here is a host bug and worth seeing.
public func hostKeyStroke(name: String, modifiers: [HostKeyModifier]) -> HostKeyStroke? {
    var flags: CGEventFlags = []
    for modifier in modifiers {
        flags.insert(modifier.eventFlag)
    }

    if let named = hostNamedKeyStrokes[name] {
        // A named key's character does not change under shift: `shift+Tab` is
        // still U+0009 with a shift flag on it, and the application decides what
        // that means. Only the printable range has a second character to give.
        return HostKeyStroke(keyCode: named.keyCode, flags: flags, characters: [named.character])
    }

    guard name.count == 1, let character = name.first, let key = hostPrintableKeys[character] else {
        return nil
    }

    // §6.4 — the printable range starts at U+0021 and not U+0020 because `Space`
    // is the only spelling of the space bar, and two spellings of one key is the
    // defect that section exists to remove. The table above holds no U+0020 row,
    // so that exclusion is structural rather than a range check to keep in step.
    let posted = modifiers.contains(.shift) ? key.shifted : character
    return HostKeyStroke(
        keyCode: key.keyCode,
        flags: flags,
        characters: Array(String(posted).utf16)
    )
}

extension HostKeyModifier {
    /// `fn` has no key code to hold down — the flag is the only way to deliver
    /// it, which is why the flags and not a key-down sequence are what a stroke
    /// carries.
    var eventFlag: CGEventFlags {
        switch self {
        case .command:
            return .maskCommand
        case .shift:
            return .maskShift
        case .option:
            return .maskAlternate
        case .control:
            return .maskControl
        case .fn:
            return .maskSecondaryFn
        }
    }
}
