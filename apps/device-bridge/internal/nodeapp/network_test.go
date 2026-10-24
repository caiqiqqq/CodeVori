package nodeapp

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

type fakeNetwork struct {
	state    networkState
	identity string
	err      error
	logins   int
}

func (n *fakeNetwork) Status(context.Context) (networkState, error)  { return n.state, n.err }
func (n *fakeNetwork) Login(context.Context) error                   { n.logins++; return nil }
func (n *fakeNetwork) WhoIs(context.Context, string) (string, error) { return n.identity, n.err }

func TestTailnetAuthorizationRequiresVisibleExplicitGrantAndChecksEveryRequest(t *testing.T) {
	dir := t.TempDir()
	n := &fakeNetwork{state: networkState{BackendState: "Running", NodeID: "self", Peers: []networkPeer{{ID: "controller", Name: "Mac"}}}, identity: "controller"}
	c := newNetworkController(dir, config{Version: 1, Hostname: "node"}, n)
	if err := c.refresh(context.Background()); err != nil {
		t.Fatal(err)
	}
	h := c.authorize(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(204) }))
	request := func() int {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("POST", "http://node/mcp", nil))
		return w.Code
	}
	if request() != 403 {
		t.Fatal("network membership granted control")
	}
	if c.grant(context.Background(), "invented", true) == nil {
		t.Fatal("invisible member accepted")
	}
	if err := c.grant(context.Background(), "controller", true); err != nil {
		t.Fatal(err)
	}
	if request() != 204 {
		t.Fatal("explicit controller denied")
	}
	if err := c.grant(context.Background(), "controller", false); err != nil {
		t.Fatal(err)
	}
	if request() != 403 {
		t.Fatal("revoked controller retained session access")
	}
	if err := c.grant(context.Background(), "controller", true); err != nil {
		t.Fatal(err)
	}
	n.err = errors.New("offline")
	if request() != 403 {
		t.Fatal("failed identity lookup granted access")
	}
	n.err = nil
	n.state.BackendState = "NeedsLogin"
	_ = c.refresh(context.Background())
	if request() != 403 {
		t.Fatal("logged-out network granted access")
	}
	restored, err := readConfig(dir)
	if err != nil || len(restored.AllowedNodes) != 1 || restored.AllowedNodes[0] != "controller" {
		t.Fatal("grant not persisted", err)
	}
}

func TestConcurrentGrantsPreserveBothAndFailedPersistenceDoesNotAuthorize(t *testing.T) {
	dir := t.TempDir()
	n := &fakeNetwork{state: networkState{BackendState: "Running", Peers: []networkPeer{{ID: "one"}, {ID: "two"}}}}
	c := newNetworkController(dir, config{Version: 1, Hostname: "node"}, n)
	var wg sync.WaitGroup
	for _, id := range []string{"one", "two"} {
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			if err := c.grant(context.Background(), id, true); err != nil {
				t.Error(err)
			}
		}(id)
	}
	wg.Wait()
	got, err := readConfig(dir)
	if err != nil || len(got.AllowedNodes) != 2 {
		t.Fatal("concurrent authorization lost an update", err)
	}
	blocked := filepath.Join(t.TempDir(), "file")
	_ = os.WriteFile(blocked, []byte("not a directory"), 0600)
	c = newNetworkController(blocked, config{Version: 1, Hostname: "node"}, n)
	if c.grant(context.Background(), "one", true) == nil || len(c.snapshot().AllowedNodes) != 0 {
		t.Fatal("failed write committed authorization")
	}
}

func TestLegacyRelayUpgradeRequiresFreshNetworkAuthorization(t *testing.T) {
	dir := t.TempDir()
	legacy := []byte(`{"serviceUrl":"https://unused.test/relay","id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","nodeToken":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}`)
	_ = os.WriteFile(filepath.Join(dir, "connection.json"), legacy, 0600)
	c, err := readConfig(dir)
	if err != nil || c.Version != 1 || len(c.AllowedNodes) != 0 || c.Hostname == "" {
		t.Fatal("legacy migration inherited control", err)
	}
	b, _ := os.ReadFile(filepath.Join(dir, "connection.json"))
	if string(b) == string(legacy) {
		t.Fatal("relay bearer was retained")
	}
}

func TestLoginStartsOnlyWhenAuthorizationURLIsMissing(t *testing.T) {
	n := &fakeNetwork{state: networkState{BackendState: "NeedsLogin"}}
	owner := newNetworkController(t.TempDir(), config{Version: 1, Hostname: "node"}, n)
	if err := owner.refresh(context.Background()); err != nil || n.logins != 0 {
		t.Fatal("status polling triggered login", err)
	}
	if err := owner.login(context.Background()); err != nil || n.logins != 1 {
		t.Fatal("interactive login not started", err)
	}
	n.state.AuthURL = "https://login.tailscale.com/example"
	if err := owner.login(context.Background()); err != nil || n.logins != 1 {
		t.Fatal("pending authorization was restarted", err)
	}
	n.state = networkState{BackendState: "Running"}
	if err := owner.login(context.Background()); err != nil || n.logins != 1 {
		t.Fatal("running identity was restarted", err)
	}
}
