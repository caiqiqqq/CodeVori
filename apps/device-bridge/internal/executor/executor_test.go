package executor

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"strings"
	"testing"
	"time"
	"unicode/utf16"
)

func rpc(t *testing.T, handler http.Handler, method, params string) map[string]any {
	t.Helper()
	r := httptest.NewRequest("POST", "/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"`+method+`","params":`+params+`}`))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	var result map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("invalid MCP response: %s (%v)", w.Body.String(), err)
	}
	return result
}

func TestCommandExecutionAndProtocol(t *testing.T) {
	s, err := New(2)
	if err != nil {
		t.Fatal(err)
	}
	if rpc(t, s, "initialize", `{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1"}}`)["result"].(map[string]any)["protocolVersion"] != "2025-03-26" {
		t.Fatal("handshake mismatch")
	}
	tools := rpc(t, s, "tools/list", `{}`)["result"].(map[string]any)["tools"].([]any)
	if len(tools) < 2 {
		t.Fatal("node and command tools missing")
	}
	command := "printf hello; printf failure >&2; exit 7"
	if runtime.GOOS == "windows" {
		command = "[Console]::Out.Write('hello'); [Console]::Error.Write('failure'); exit 7"
	}
	args, _ := json.Marshal(map[string]any{"name": "command_run", "arguments": map[string]any{"command": command, "cwd": t.TempDir()}})
	r := rpc(t, s, "tools/call", string(args))["result"].(map[string]any)
	if r["isError"] == true {
		t.Fatalf("command failed: %v", r)
	}
	var output map[string]any
	if err := json.Unmarshal([]byte(r["content"].([]any)[0].(map[string]any)["text"].(string)), &output); err != nil {
		t.Fatal(err)
	}
	if output["exitCode"] != float64(7) || output["stdout"] != "hello" || output["stderr"] != "failure" {
		t.Fatalf("wrong result: %v", output)
	}
	for _, invalid := range []string{`{"command":"echo wrong","cwd":"relative"}`, `{"command":"echo wrong","cwd":"/","timeoutSeconds":601}`, `{"command":"echo wrong","cwd":"/","env":{"EXTRA":"ignored"}}`} {
		r = rpc(t, s, "tools/call", `{"name":"command_run","arguments":`+invalid+`}`)["result"].(map[string]any)
		if r["isError"] != true {
			t.Fatalf("invalid input accepted: %s", invalid)
		}
	}
	if rpc(t, s, "unknown", `{}`)["error"].(map[string]any)["code"] != float64(-32601) {
		t.Fatal("unknown method accepted")
	}
}

func TestCapacityAndOutputLimits(t *testing.T) {
	s, _ := New(1)
	s.commands <- struct{}{}
	_, err := s.runCommand(context.Background(), commandArgs{Command: "echo should-not-run", Cwd: t.TempDir()})
	if err == nil || err.Error() != "node_busy" {
		t.Fatalf("busy command admitted: %v", err)
	}
	<-s.commands
	b := &limitedBuffer{limit: 4}
	if n, err := b.Write([]byte("abcdef")); n != 6 || err != nil || b.String() != "abcd" || !b.truncated {
		t.Fatal("output must be capped without deadlocking child writes")
	}
}

func TestCommandCancellation(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix process group test; Windows lifecycle requires Windows runner")
	}
	s, _ := New(1)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := s.runCommand(ctx, commandArgs{Command: "sleep 30", Cwd: t.TempDir()})
	if err == nil {
		t.Fatal("cancelled request executed")
	}
	if len(s.commands) != 0 {
		t.Fatal("cancelled command retained capacity")
	}
	start := time.Now()
	_, err = s.runCommand(context.Background(), commandArgs{Command: "sleep 30 & wait", Cwd: t.TempDir(), TimeoutSeconds: 1})
	if err == nil || time.Since(start) > 5*time.Second || len(s.commands) != 0 {
		t.Fatalf("timeout failed to release process group/capacity: %v", err)
	}
}

func TestPlatformCapabilitiesAndInputIsolation(t *testing.T) {
	look := func(string) (string, error) { return "/synthetic/tool", nil }
	for _, platform := range []string{"windows", "darwin", "linux"} {
		d := newDesktop(platform, look, func(key string) string {
			if key == "DISPLAY" {
				return ":0"
			}
			return ""
		})
		if !d.has("desktop_click") || !d.has("desktop_screenshot") {
			t.Fatalf("missing tools on %s", platform)
		}
		text := `"; $(touch /should-not-exist); ' \ 中文`
		plan, err := d.plan("desktop_type", desktopArgs{Text: text})
		if err != nil {
			t.Fatal(err)
		}
		joined := strings.Join(plan.args, " ")
		if platform == "windows" {
			encoded, err := base64.StdEncoding.DecodeString(plan.args[len(plan.args)-1])
			if err != nil {
				t.Fatal(err)
			}
			units := make([]uint16, len(encoded)/2)
			for i := range units {
				units[i] = binary.LittleEndian.Uint16(encoded[i*2:])
			}
			joined = string(utf16.Decode(units))
			if !strings.Contains(joined, literal(text)) {
				t.Fatal("text must be encoded as literal data inside PowerShell")
			}
		}
		if platform != "linux" && strings.Contains(joined, text) {
			t.Fatal("text interpolated into executable source")
		}
		if platform == "linux" && plan.args[len(plan.args)-1] != text {
			t.Fatal("text must be one literal argv")
		}
	}
	d := newDesktop("linux", look, func(k string) string {
		if k == "XDG_SESSION_TYPE" {
			return "wayland"
		}
		return ":0"
	})
	if d.has("desktop_click") || d.reason != "wayland_not_supported" {
		t.Fatal("Wayland advertised as X11")
	}
	d = newDesktop("linux", func(string) (string, error) { return "", os.ErrNotExist }, func(string) string { return ":0" })
	if d.has("desktop_click") || d.has("desktop_screenshot") {
		t.Fatal("missing dependencies advertised as ready")
	}
	if _, err := newDesktop("darwin", look, os.Getenv).plan("desktop_key", desktopArgs{Key: "unknown key"}); err == nil {
		t.Fatal("unknown key accepted")
	}
}

func TestScreenshotIsMcpImageAndDesktopIsExclusive(t *testing.T) {
	s, _ := New(1)
	s.desktop = newDesktop("linux", func(string) (string, error) { return "/synthetic", nil }, func(key string) string {
		if key == "DISPLAY" {
			return ":0"
		}
		return ""
	})
	s.desktop.execute = func(context.Context, actionPlan) ([]byte, error) { return []byte("\x89PNG\r\n\x1a\nsynthetic"), nil }
	r := rpc(t, s, "tools/call", `{"name":"desktop_screenshot","arguments":{}}`)["result"].(map[string]any)
	image := r["content"].([]any)[0].(map[string]any)
	if image["type"] != "image" || image["mimeType"] != "image/png" || image["data"] != base64.StdEncoding.EncodeToString([]byte("\x89PNG\r\n\x1a\nsynthetic")) {
		t.Fatalf("wrong image: %v", image)
	}
	s.desktopBusy <- struct{}{}
	r = rpc(t, s, "tools/call", `{"name":"desktop_click","arguments":{"x":1,"y":2}}`)["result"].(map[string]any)
	if r["isError"] != true {
		t.Fatal("concurrent desktop operation admitted")
	}
	<-s.desktopBusy
}
