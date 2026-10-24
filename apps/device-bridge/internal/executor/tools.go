package executor

func (s *Server) tools() []any {
	property := func(kind, description string) map[string]any {
		return map[string]any{"type": kind, "description": description}
	}
	tool := func(name, description string, props map[string]any, required []string) any {
		if required == nil {
			required = []string{}
		}
		return map[string]any{"name": name, "description": description, "inputSchema": map[string]any{"type": "object", "properties": props, "required": required, "additionalProperties": false}}
	}
	list := []any{
		tool("node_info", "Read this node's actual OS, architecture, CPU count, command capacity and desktop backend availability.", map[string]any{}, nil),
		tool("node_status", "Read CPU usage sampled over 300ms, memory and up to 100 processes ordered by resident memory. Process CPU is cumulative seconds. Missing measurements are null; partial process coverage is explicit. No shell execution.", map[string]any{}, nil),
		tool("command_run", "Execute a command on THIS remote device using its platform shell (PowerShell on Windows, /bin/sh elsewhere). Requires an explicit absolute cwd. No automatic retry. Nonzero exitCode is a completed process result. Cancellation may leave the outcome unknown.", map[string]any{"command": property("string", "Command/script; maximum 16384 bytes"), "cwd": property("string", "Absolute working directory on THIS device"), "timeoutSeconds": map[string]any{"type": "integer", "minimum": 1, "maximum": 600, "description": "Default 60 seconds"}}, []string{"command", "cwd"}),
	}
	for _, name := range []string{"desktop_screenshot", "desktop_click", "desktop_type", "desktop_key", "desktop_scroll"} {
		if !s.desktop.has(name) {
			continue
		}
		props := map[string]any{}
		var required []string
		var description string
		switch name {
		case "desktop_screenshot":
			description = "Capture the interactive desktop as a PNG image. Windows/macOS capture the primary screen with coordinates matching desktop_click; Linux captures the X11 root. Requires screen recording permission."
		case "desktop_click":
			description = "Left-click at absolute screen coordinates. Single operations are exclusive; the main runtime must keep a whole desktop workflow on one task. Re-observe after input."
			props["x"] = property("integer", "Absolute horizontal coordinate")
			props["y"] = property("integer", "Absolute vertical coordinate")
			required = []string{"x", "y"}
		case "desktop_type":
			description = "Type literal Unicode text into the focused application. Text is data, never a command. Re-observe to confirm the effect."
			props["text"] = property("string", "Literal text, maximum 8192 bytes")
			required = []string{"text"}
		case "desktop_key":
			description = "Send one key or shortcut. Keys: A-Z, 0-9, Enter, Tab, Escape, Backspace, Delete, Space, ArrowLeft/Right/Up/Down, Home, End, PageUp/Down. Optional prefixes: Ctrl, Alt, Shift, Meta (for example Ctrl+C or Meta+V)."
			props["key"] = property("string", "Key/shortcut")
			required = []string{"key"}
		case "desktop_scroll":
			description = "Scroll vertically; positive values scroll down, negative up. Re-observe after input."
			props["deltaY"] = map[string]any{"type": "integer", "minimum": -100, "maximum": 100}
			required = []string{"deltaY"}
		}
		list = append(list, tool(name, description, props, required))
	}
	return list
}
