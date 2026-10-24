package pairing

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"zcode.local/device-bridge/internal/executor"
)

func TestEnrollmentRelayLifecycle(t *testing.T) {
	dir := t.TempDir()
	s, err := New(Config{StateDir: dir, PublicURL: "http://127.0.0.1", AssetsDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	host := httptest.NewServer(s)
	defer host.Close()
	defer s.Close()
	do := func(method, path, token string, body any, code int) map[string]any {
		t.Helper()
		b, _ := json.Marshal(body)
		r, _ := http.NewRequest(method, host.URL+path, bytes.NewReader(b))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Authorization", "Bearer "+token)
		resp, e := http.DefaultClient.Do(r)
		if e != nil {
			t.Fatal(e)
		}
		defer resp.Body.Close()
		if resp.StatusCode != code {
			v, _ := io.ReadAll(resp.Body)
			t.Fatalf("%s %s: %d %s", method, path, resp.StatusCode, v)
		}
		var v map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&v)
		return v
	}
	p := do("POST", "/v1/pairs", "", map[string]string{"platform": "win32-x64", "name": "Test PC"}, 201)
	id, controller, inv := p["id"].(string), p["controllerToken"].(string), p["invitation"].(string)
	path := "/v1/pairs/" + id
	do("GET", path, "wrong", nil, 401)
	c := do("POST", "/v1/redeem", "", map[string]string{"invitation": inv, "nonce": "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG"}, 200)
	node := c["nodeToken"].(string)
	again := do("POST", "/v1/redeem", "", map[string]string{"invitation": inv, "nonce": "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG"}, 200)
	if again["nodeToken"] != node {
		t.Fatal("non-idempotent redeem")
	}
	do("POST", "/v1/redeem", "", map[string]string{"invitation": inv, "nonce": "BCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqr"}, 409)
	do("GET", path, node, nil, 401)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	hdr := http.Header{"Authorization": []string{"Bearer " + node}}
	conn, _, err := websocket.Dial(ctx, host.URL+path+"/socket", &websocket.DialOptions{HTTPHeader: hdr})
	if err != nil {
		t.Fatal(err)
	}
	handler, _ := executor.New(2)
	done := make(chan error, 1)
	go func() { done <- ServeExecutor(ctx, conn, handler) }()
	result := do("POST", path+"/mcp", controller, map[string]any{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, 200)
	if result["result"] == nil {
		t.Fatalf("missing tools: %v", result)
	}
	result = do("POST", path+"/mcp", controller, map[string]any{"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": map[string]any{"name": "command_run", "arguments": map[string]any{"command": "printf paired", "cwd": filepath.Clean(dir)}}}, 200)
	data, _ := json.Marshal(result)
	if !bytes.Contains(data, []byte("paired")) {
		t.Fatalf("actual shell output missing: %s", data)
	}
	do("DELETE", path, controller, nil, 204)
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("revoke did not disconnect node")
	}
	do("POST", path+"/mcp", controller, map[string]any{}, 401)
}

func TestStatePersistenceAndExpiry(t *testing.T) {
	dir := t.TempDir()
	cfg := Config{StateDir: dir, PublicURL: "http://127.0.0.1", AssetsDir: t.TempDir()}
	s, e := New(cfg)
	if e != nil {
		t.Fatal(e)
	}
	req := httptest.NewRequest("POST", "/v1/pairs", bytes.NewBufferString(`{"platform":"linux-arm64","name":"Owner"}`))
	w := httptest.NewRecorder()
	s.ServeHTTP(w, req)
	if w.Code != 201 {
		t.Fatal(w.Code)
	}
	var p map[string]string
	_ = json.Unmarshal(w.Body.Bytes(), &p)
	s.Close()
	s, e = New(cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	r := httptest.NewRequest("GET", "/v1/pairs/"+p["id"], nil)
	r.Header.Set("Authorization", "Bearer "+p["controllerToken"])
	w = httptest.NewRecorder()
	s.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatal("lost owner after restart", w.Code)
	}
	s.mu.Lock()
	s.records[p["id"]].ExpiresAt = time.Now().Add(-time.Minute)
	s.mu.Unlock()
	r = httptest.NewRequest("POST", "/v1/redeem", bytes.NewBufferString(`{"invitation":"`+p["invitation"]+`","nonce":"abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG"}`))
	w = httptest.NewRecorder()
	s.ServeHTTP(w, r)
	if w.Code != 410 {
		t.Fatal("expired invitation accepted", w.Code)
	}
}

func TestIndependentInstallerDownloadAndSecretStorage(t *testing.T) {
	dir, assets := t.TempDir(), t.TempDir()
	if e := os.WriteFile(filepath.Join(assets, "CodeVoriNode-win32-x64.exe"), []byte("MZ-test-independent-client"), 0755); e != nil {
		t.Fatal(e)
	}
	s, e := New(Config{StateDir: dir, AssetsDir: assets, PublicURL: "http://127.0.0.1"})
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	create := httptest.NewRecorder()
	s.ServeHTTP(create, httptest.NewRequest("POST", "/v1/pairs", strings.NewReader(`{"platform":"win32-x64","name":"Owner"}`)))
	var p map[string]string
	_ = json.Unmarshal(create.Body.Bytes(), &p)
	disk, _ := os.ReadFile(filepath.Join(dir, "pairings.json"))
	for _, key := range []string{p["invitation"], p["controllerToken"]} {
		if bytes.Contains(disk, []byte(key)) {
			t.Fatal("plaintext capability persisted by relay")
		}
	}
	download := httptest.NewRecorder()
	s.ServeHTTP(download, httptest.NewRequest("GET", "/v1/download/"+p["invitation"]+"/win32-x64", nil))
	if download.Code != 200 || download.Body.String() != "MZ-test-independent-client" {
		t.Fatal("external installer unavailable", download.Code)
	}
	if !strings.Contains(download.Header().Get("Content-Disposition"), p["invitation"]) {
		t.Fatal("installer lost its one-time binding")
	}
	crossed := httptest.NewRecorder()
	s.ServeHTTP(crossed, httptest.NewRequest("GET", "/v1/download/"+p["invitation"]+"/linux-x64", nil))
	if crossed.Code != 410 {
		t.Fatal("platform crossover allowed", crossed.Code)
	}
	r := httptest.NewRequest("GET", "/v1/pairs/"+p["id"]+"/socket", nil)
	r.Header.Set("Authorization", "Bearer "+p["controllerToken"])
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	if w.Code != 401 {
		t.Fatal("controller authenticated as node")
	}
	patch := httptest.NewRequest("PATCH", "/v1/pairs/"+p["id"], strings.NewReader(`{"enabled":false}`))
	patch.Header.Set("Authorization", "Bearer "+p["controllerToken"])
	w = httptest.NewRecorder()
	s.ServeHTTP(w, patch)
	if w.Code != 204 {
		t.Fatal(w.Code)
	}
	req := httptest.NewRequest("POST", "/v1/pairs/"+p["id"]+"/mcp", strings.NewReader(`{}`))
	req.Header.Set("Authorization", "Bearer "+p["controllerToken"])
	w = httptest.NewRecorder()
	s.ServeHTTP(w, req)
	if w.Code != 403 {
		t.Fatal("disabled execution accepted", w.Code)
	}
}

func TestInstallerCanLiveOnSeparateHTTPFileServer(t *testing.T) {
	requests := 0
	asset := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.URL.Path != "/clients/CodeVoriNode-win32-x64.exe" || r.Header.Get("Authorization") != "" {
			t.Error("asset request leaked credentials or used wrong file", r.URL.Path)
		}
		_, _ = io.WriteString(w, "MZ-external-file-server")
	}))
	defer asset.Close()
	s, e := New(Config{StateDir: t.TempDir(), PublicURL: "http://127.0.0.1", AssetsURL: asset.URL + "/clients"})
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	w := httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest("POST", "/v1/pairs", strings.NewReader(`{"platform":"win32-x64","name":"Owner"}`)))
	var p map[string]string
	_ = json.Unmarshal(w.Body.Bytes(), &p)
	w = httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest("GET", "/v1/download/"+p["invitation"]+"/win32-x64", nil))
	if w.Code != 200 || w.Body.String() != "MZ-external-file-server" || requests != 1 {
		t.Fatal("external artifact delivery failed", w.Code, w.Body.String(), requests)
	}
}
