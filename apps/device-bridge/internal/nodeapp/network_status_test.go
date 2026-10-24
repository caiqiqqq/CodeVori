package nodeapp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"zcode.local/device-bridge/internal/bridge"
	"zcode.local/device-bridge/internal/executor"
)

func TestPrivateStatusControlsLoginAndAuthorization(t *testing.T) {
	n := &fakeNetwork{state: networkState{BackendState: "Running", NodeID: "self", Peers: []networkPeer{{ID: "controller", Name: "Mac"}}}, identity: "controller"}
	owner := newNetworkController(t.TempDir(), config{Version: 1, Hostname: "node"}, n)
	s := newLocalStatus(t.TempDir(), func() {})
	s.network = owner
	if err := s.start(); err != nil {
		t.Fatal(err)
	}
	defer s.close()
	request := func(path, origin, body string) int {
		r := httptest.NewRequest("POST", s.state.Address+path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		return w.Code
	}
	base := "/" + s.state.Token
	for _, action := range []string{"login", "authorize"} {
		if request(base+"/"+action, "https://attacker.test", "nodeId=controller&allowed=true") != 403 {
			t.Fatal("cross-origin mutation accepted", action)
		}
		if request("/wrong/"+action, s.state.Address, "") != 404 {
			t.Fatal("public mutation accepted", action)
		}
	}
	if request(base+"/login", s.state.Address, "") != 303 {
		t.Fatal("login rejected")
	}
	for _, body := range []string{"nodeId=controller&allowed=true&allowed=false", "nodeId=controller&allowed=yes", "nodeId=controller", "nodeId=controller&allowed=true&extra=1", "nodeId=" + strings.Repeat("x", 2100) + "&allowed=true"} {
		if request(base+"/authorize", s.state.Address, body) != 400 {
			t.Fatal("malformed authorization accepted")
		}
	}
	if request(base+"/authorize", s.state.Address, "nodeId=unknown&allowed=true") != 503 || len(owner.snapshot().AllowedNodes) != 0 {
		t.Fatal("unknown controller accepted")
	}
	if request(base+"/authorize", s.state.Address, "nodeId=controller&allowed=true") != 303 {
		t.Fatal("visible controller rejected")
	}
	if got, err := readConfig(owner.dir); err != nil || len(got.AllowedNodes) != 1 {
		t.Fatal("authorization was not persisted", err)
	}
	// 网络成员消失或状态查询失败也必须可以撤销已有授权。
	n.state.Peers = nil
	if request(base+"/authorize", s.state.Address, "nodeId=controller&allowed=false") != 303 || len(owner.snapshot().AllowedNodes) != 0 {
		t.Fatal("invisible controller could not be revoked")
	}
	r := httptest.NewRequest("POST", s.state.Address+base+"/login", nil)
	r.Host = "attacker.test"
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("foreign Host accepted")
	}
}

func TestStatusEscapesMemberNamesAndRejectsUnsafeLoginLinks(t *testing.T) {
	v := networkView{networkState: networkState{BackendState: "NeedsLogin", NodeID: "node", DNSName: `<script>alert(1)</script>`, Peers: []networkPeer{{ID: "controller", Name: `<img src=x onerror=alert(1)>`}}}, AllowedNodes: []string{"removed"}}
	for _, address := range []string{"javascript:alert(1)", "http://example.test", "https://user:pass@example.test"} {
		v.AuthURL = address
		_, body := renderNetwork(v, "private")
		if strings.Contains(body, `<a `) || strings.Contains(body, "<script>") || strings.Contains(body, "<img ") || !strings.Contains(body, "removed") {
			t.Fatal("unsafe status content or missing revoke", address)
		}
	}
	v.AuthURL = "https://login.tailscale.com/a?x=1&y=2"
	_, body := renderNetwork(v, "private")
	if !strings.Contains(body, `href="https://login.tailscale.com/a?x=1&amp;y=2"`) {
		t.Fatal("valid authorization URL missing")
	}
}

func TestAuthorizedNodeMcpHandshakeAndCommandThenRevocation(t *testing.T) {
	n := &fakeNetwork{state: networkState{BackendState: "Running", Peers: []networkPeer{{ID: "controller"}}}, identity: "controller"}
	owner := newNetworkController(t.TempDir(), config{Version: 1, Hostname: "node"}, n)
	if err := owner.grant(context.Background(), "controller", true); err != nil {
		t.Fatal(err)
	}
	e, err := executor.New(2)
	if err != nil {
		t.Fatal(err)
	}
	s := httptest.NewServer(bridge.Endpoint(owner.authorize(e)))
	defer s.Close()
	call := func(method string, params any) (int, map[string]any) {
		t.Helper()
		data, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
		response, err := http.Post(s.URL+"/mcp", "application/json", strings.NewReader(string(data)))
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		var result map[string]any
		if response.StatusCode == 200 {
			if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
				t.Fatal(err)
			}
		}
		return response.StatusCode, result
	}
	if code, r := call("initialize", map[string]any{"protocolVersion": "2025-03-26"}); code != 200 || r["result"] == nil {
		t.Fatal("MCP handshake failed", code, r)
	}
	if code, r := call("tools/list", map[string]any{}); code != 200 || r["result"] == nil {
		t.Fatal("MCP tool discovery failed", code, r)
	}
	if code, r := call("tools/call", map[string]any{"name": "command_run", "arguments": map[string]any{"command": "echo tailnet-command", "cwd": t.TempDir()}}); code != 200 || r["result"] == nil || !strings.Contains(string(mustJSON(r)), "tailnet-command") {
		t.Fatal("command roundtrip failed", code, r)
	}
	if err := owner.grant(context.Background(), "controller", false); err != nil {
		t.Fatal(err)
	}
	if code, _ := call("tools/list", map[string]any{}); code != 403 {
		t.Fatal("revoked controller retained MCP access", code)
	}
}
func mustJSON(v any) []byte { b, _ := json.Marshal(v); return b }
