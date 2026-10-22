package bridge

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
)

// A real HTTP socket closes after receiving a request. The proxy must not submit it again.
func TestTransportDoesNotReplayFailedGet(t *testing.T) {
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		conn, _, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		conn.Close()
	}))
	defer upstream.Close()
	u, _ := url.Parse(upstream.URL + "/mcp")
	p, tr := Proxy(u, nil, "")
	defer tr.CloseIdleConnections()
	local := httptest.NewServer(Endpoint(p))
	defer local.Close()
	resp, err := http.Get(local.URL + "/mcp")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 502 || calls.Load() != 1 {
		t.Fatalf("status %d, upstream calls %d", resp.StatusCode, calls.Load())
	}
}

func TestConnectionErrorsDoNotLeakCredentials(t *testing.T) {
	u, _ := url.Parse("http://127.0.0.1:8000/mcp")
	p, tr := Proxy(u, func(context.Context, string, string) (net.Conn, error) {
		return nil, errors.New("private address upstream-secret")
	}, "upstream-secret")
	defer tr.CloseIdleConnections()
	w := httptest.NewRecorder()
	p.ServeHTTP(w, httptest.NewRequest("POST", "http://device/mcp", strings.NewReader("body")))
	if w.Code != 502 || strings.Contains(w.Body.String(), "upstream-secret") || strings.Contains(w.Body.String(), "private address") {
		t.Fatalf("unsafe error: %d %s", w.Code, w.Body.String())
	}
}

func TestPinnedDialAcceptsExpectedIdentity(t *testing.T) {
	client, server := net.Pipe()
	defer server.Close()
	defer client.Close()
	dial := PinnedDial(func(context.Context, string, string) (net.Conn, error) { return client, nil }, fakeIdentity("expected", nil), "expected")
	conn, err := dial(context.Background(), "tcp", "device:8743")
	if err != nil || conn != client {
		t.Fatalf("expected peer denied: %v", err)
	}
}

func TestEmptyAllowlistNeverCallsUpstream(t *testing.T) {
	h := AuthorizeNode(fakeIdentity("node", nil), nil, http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Fatal("empty allowlist reached upstream") }))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "http://device/mcp", nil))
	if w.Code != 403 {
		t.Fatal(w.Code)
	}
}

func TestSessionDeleteAndNotificationResponse(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "DELETE" || r.Header.Get("Mcp-Session-Id") != "session-1" {
			t.Error("session deletion changed")
		}
		w.WriteHeader(202)
	}))
	defer upstream.Close()
	u, _ := url.Parse(upstream.URL + "/mcp")
	p, tr := Proxy(u, nil, "")
	defer tr.CloseIdleConnections()
	r := httptest.NewRequest("DELETE", "http://device/mcp", nil)
	r.Header.Set("Mcp-Session-Id", "session-1")
	w := httptest.NewRecorder()
	Endpoint(p).ServeHTTP(w, r)
	if w.Code != 202 {
		t.Fatal(w.Code)
	}
	body, _ := io.ReadAll(w.Result().Body)
	if len(body) != 0 {
		t.Fatalf("unexpected response body %q", body)
	}
}
