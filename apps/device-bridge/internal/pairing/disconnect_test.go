package pairing

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/coder/websocket"
	"zcode.local/device-bridge/internal/executor"
)

func TestDisconnectCancelsInFlightCommandWithoutReplay(t *testing.T) {
	s, e := New(Config{StateDir: t.TempDir(), AssetsDir: t.TempDir(), PublicURL: "http://127.0.0.1"})
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	w := httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest("POST", "/v1/pairs", bytes.NewBufferString(`{"platform":"linux-x64","name":"Owner"}`)))
	var created map[string]string
	_ = json.Unmarshal(w.Body.Bytes(), &created)
	nonce := token()
	body, _ := json.Marshal(map[string]string{"invitation": created["invitation"], "nonce": nonce})
	w = httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest("POST", "/v1/redeem", bytes.NewReader(body)))
	var node map[string]string
	_ = json.Unmarshal(w.Body.Bytes(), &node)
	host := httptest.NewServer(s)
	defer host.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	headers := http.Header{"Authorization": []string{"Bearer " + node["nodeToken"]}}
	connect := func() *websocket.Conn {
		t.Helper()
		c, _, err := websocket.Dial(ctx, host.URL+"/v1/pairs/"+created["id"]+"/socket", &websocket.DialOptions{HTTPHeader: headers})
		if err != nil {
			t.Fatal(err)
		}
		return c
	}
	c := connect()
	handler, _ := executor.New(2)
	entered := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		done <- ServeExecutor(ctx, c, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { close(entered); handler.ServeHTTP(w, r) }))
	}()
	dir := t.TempDir()
	marker := filepath.Join(dir, "must-not-exist")
	command, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": map[string]any{"name": "command_run", "arguments": map[string]any{"command": "sleep 30; touch must-not-exist", "cwd": dir}}})
	req, _ := http.NewRequest("POST", host.URL+"/v1/pairs/"+created["id"]+"/mcp", bytes.NewReader(command))
	req.Header.Set("Authorization", "Bearer "+created["controllerToken"])
	result := make(chan int, 1)
	go func() {
		r, err := http.DefaultClient.Do(req)
		if err != nil {
			result <- 0
			return
		}
		r.Body.Close()
		result <- r.StatusCode
	}()
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("execution did not start")
	}
	_ = c.CloseNow()
	select {
	case code := <-result:
		if code != 502 {
			t.Fatal("disconnect hid unknown outcome", code)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("HTTP did not fail on disconnect")
	}
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("in-flight process not canceled")
	}
	if _, e := os.Stat(marker); !os.IsNotExist(e) {
		t.Fatal("canceled command continued")
	}
	// Reconnect only after the server has removed the old transport, using status as the owner signal.
	deadline := time.After(3 * time.Second)
	for {
		s.mu.Lock()
		offline := s.links[created["id"]] == nil
		s.mu.Unlock()
		if offline {
			break
		}
		select {
		case <-deadline:
			t.Fatal("stale connection retained")
		case <-time.After(time.Millisecond):
		}
	}
	reconnected := connect()
	defer reconnected.CloseNow()
	readCtx, stop := context.WithTimeout(ctx, 100*time.Millisecond)
	defer stop()
	if _, _, e := reconnected.Read(readCtx); e == nil {
		t.Fatal("interrupted command replayed")
	}
}
