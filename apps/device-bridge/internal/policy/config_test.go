package policy

import "testing"

func TestTargetMustBeFixedLoopbackEndpoint(t *testing.T) {
	for _, raw := range []string{"http://127.0.0.1:8000/mcp", "http://[::1]:8000/custom"} {
		if _, err := Target(raw); err != nil {
			t.Errorf("valid target %q: %v", raw, err)
		}
	}
	for _, raw := range []string{"https://127.0.0.1/mcp", "http://localhost/mcp", "http://example.com/mcp", "http://127.0.0.1:0/mcp", "http://127.0.0.1:8000", "http://user:secret@127.0.0.1/mcp", "http://127.0.0.1/mcp?token=x", "http://127.0.0.1/mcp#x"} {
		if _, err := Target(raw); err == nil {
			t.Errorf("accepted target %q", raw)
		}
	}
}

func TestListenerAndPeerValidation(t *testing.T) {
	for _, addr := range []string{"127.0.0.1:18743", "127.0.0.2:0"} {
		if err := LocalListener(addr); err != nil {
			t.Error(err)
		}
	}
	for _, addr := range []string{"0.0.0.0:18743", "localhost:18743", "[::]:18743", "[::1]:18743", "127.0.0.1:-1", "127.0.0.1:65536"} {
		if err := LocalListener(addr); err == nil {
			t.Errorf("accepted listen %q", addr)
		}
	}
	for _, peer := range []string{"windows.example.ts.net:8743", "100.64.0.1:8743", "[fd7a:115c:a1e0::1]:8743"} {
		if err := Peer(peer); err != nil {
			t.Error(err)
		}
	}
	for _, peer := range []string{"https://windows:8743/mcp", "windows", "windows:0", "windows:65536", ":8743", "a/b:8743", "a@b:8743"} {
		if err := Peer(peer); err == nil {
			t.Errorf("accepted peer %q", peer)
		}
	}
}
