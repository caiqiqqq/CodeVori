package bridge

import (
	"strings"
	"testing"

	"tailscale.com/ipn/ipnstate"
	"tailscale.com/tailcfg"
	"tailscale.com/types/key"
)

func TestManagedRequestValidation(t *testing.T) {
	for _, raw := range []string{`{"id":"1","method":"status"}`, `{"id":"2","method":"connect","nodeId":"device"}`, `{"id":"3","method":"expose","allowedNodes":["mac"]}`} {
		if _, err := decodeCommand([]byte(raw)); err != nil {
			t.Fatal(err)
		}
	}
	for _, raw := range []string{`{"method":"status"}`, `{"id":"1","method":"shell"}`, `{"id":"1","method":"connect"}`, `{"id":"1","method":"status","command":"secret"}`, `{"id":"1","method":"status"} {}`} {
		if _, err := decodeCommand([]byte(raw)); err == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
}

func TestInventoryIsProjectionWithoutTokens(t *testing.T) {
	st := &ipnstate.Status{BackendState: "Running", Self: &ipnstate.PeerStatus{ID: tailcfg.StableNodeID("self"), UserID: 1}, User: map[tailcfg.UserID]tailcfg.UserProfile{1: {LoginName: "synthetic@example.test"}}, Peer: map[key.NodePublic]*ipnstate.PeerStatus{key.NewNode().Public(): {ID: "peer", HostName: "Windows", OS: "windows", Online: true}}}
	s := inventory(st, map[string]*managedConnection{}, map[string]bool{"peer": true}, false)
	if s.NodeID != "self" || s.LoginName != "synthetic@example.test" || len(s.Peers) != 1 || !s.Peers[0].Allowed {
		t.Fatalf("bad inventory %+v", s)
	}
	if _, err := findPeer(st, "missing"); err == nil {
		t.Fatal("unknown stable ID accepted")
	}
	if _, err := decodeCommand([]byte(`{"id":"` + strings.Repeat("a", 129) + `","method":"status"}`)); err == nil {
		t.Fatal("unbounded request ID")
	}
}
