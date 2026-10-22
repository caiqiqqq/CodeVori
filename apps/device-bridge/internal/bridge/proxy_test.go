package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const testToken = "test-token-with-at-least-32-characters"

func fakeIdentity(id string, err error) IdentityLookup {
	return func(context.Context, string) (string, error) { return id, err }
}

func TestServeDeniesUnknownNodes(t *testing.T) {
	var calls atomic.Int32
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.WriteHeader(204) })
	for _, tc := range []struct {
		name, id string
		err      error
		want     int
	}{
		{"allowed", "allowed", nil, 204}, {"other", "other", nil, 403}, {"empty", "", nil, 403}, {"lookup failed", "allowed", errors.New("secret"), 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := AuthorizeNode(fakeIdentity(tc.id, tc.err), []string{"allowed"}, next)
			r := httptest.NewRequest("POST", "http://device/mcp", nil)
			r.Header.Set("X-Forwarded-For", "allowed")
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != tc.want || strings.Contains(w.Body.String(), "secret") {
				t.Fatalf("status/body %d %s", w.Code, w.Body.String())
			}
		})
	}
	if calls.Load() != 1 {
		t.Fatal("unauthorized request reached upstream")
	}
}

func TestLocalGatewayChecksTokenHostOriginAndPath(t *testing.T) {
	for _, tc := range []struct {
		name, token, host, origin, path, method string
		want                                    int
	}{
		{"valid", testToken, "127.0.0.1:18743", "", "/mcp", "POST", 204},
		{"missing token", "", "127.0.0.1:18743", "", "/mcp", "POST", 401},
		{"wrong token", "wrong", "127.0.0.1:18743", "", "/mcp", "POST", 401},
		{"foreign host", testToken, "evil.example:18743", "", "/mcp", "POST", 403},
		{"origin", testToken, "127.0.0.1:18743", "https://evil.example", "/mcp", "POST", 403},
		{"path", testToken, "127.0.0.1:18743", "", "/other", "POST", 404},
		{"escaped path", testToken, "127.0.0.1:18743", "", "/%6dcp", "POST", 404},
		{"method", testToken, "127.0.0.1:18743", "", "/mcp", "PUT", 405},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := LocalGateway(testToken, Endpoint(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })))
			r := httptest.NewRequest(tc.method, "http://"+tc.host+tc.path, nil)
			if tc.token != "" {
				r.Header.Set("Authorization", "Bearer "+tc.token)
			}
			if tc.origin != "" {
				r.Header.Set("Origin", tc.origin)
			}
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != tc.want {
				t.Fatalf("got %d want %d", w.Code, tc.want)
			}
		})
	}
}

func TestMcpRoundTripThroughBothBridges(t *testing.T) {
	var expectedHost string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/custom-mcp" || r.URL.RawQuery != "cursor=next" {
			t.Errorf("upstream URL %s", r.URL)
		}
		if r.Host != expectedHost {
			t.Error("upstream Host was not rewritten")
		}
		if r.Header.Get("Authorization") != "Bearer upstream-secret" {
			t.Error("upstream credential missing")
		}
		for _, key := range []string{"Forwarded", "X-Forwarded-For", "X-Forwarded-Host", "X-Forwarded-Proto"} {
			if r.Header.Get(key) != "" {
				t.Errorf("spoofed header %s", key)
			}
		}
		if r.Header.Get("MCP-Protocol-Version") != "2025-03-26" {
			t.Error("protocol header lost")
		}
		var msg map[string]any
		if err := json.NewDecoder(r.Body).Decode(&msg); err != nil {
			t.Error(err)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Mcp-Session-Id", "session-1")
		switch msg["method"] {
		case "initialize":
			io.WriteString(w, `{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-03-26","capabilities":{"tools":{}},"serverInfo":{"name":"fake-windows","version":"1"}}}`)
		case "tools/list":
			if r.Header.Get("Mcp-Session-Id") != "session-1" {
				t.Error("session header lost")
			}
			io.WriteString(w, `{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"Snapshot","inputSchema":{"type":"object"}}]}}`)
		case "tools/call":
			io.WriteString(w, `{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"image","data":"aW1hZ2U=","mimeType":"image/png"}]}}`)
		default:
			t.Error("unexpected MCP method")
		}
	}))
	defer upstream.Close()
	upstreamURL, _ := url.Parse(upstream.URL + "/custom-mcp")
	expectedHost = upstreamURL.Host
	serverProxy, serverTransport := Proxy(upstreamURL, nil, "upstream-secret")
	defer serverTransport.CloseIdleConnections()
	remote := httptest.NewServer(Endpoint(AuthorizeNode(fakeIdentity("mac-node", nil), []string{"mac-node"}, serverProxy)))
	defer remote.Close()
	remoteURL, _ := url.Parse(remote.URL + "/mcp")
	clientProxy, clientTransport := Proxy(remoteURL, nil, "")
	defer clientTransport.CloseIdleConnections()
	local := httptest.NewServer(LocalGateway(testToken, Endpoint(clientProxy)))
	defer local.Close()
	for i, method := range []string{"initialize", "tools/list", "tools/call"} {
		r, _ := http.NewRequest("POST", local.URL+"/mcp?cursor=next", strings.NewReader(`{"jsonrpc":"2.0","id":`+string(rune('1'+i))+`,"method":"`+method+`","params":{}}`))
		r.Header.Set("Authorization", "Bearer "+testToken)
		r.Header.Set("MCP-Protocol-Version", "2025-03-26")
		r.Header.Set("Mcp-Session-Id", "session-1")
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Forwarded", "for=evil")
		r.Header.Set("X-Forwarded-For", "evil")
		resp, err := http.DefaultClient.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != 200 || resp.Header.Get("Mcp-Session-Id") != "session-1" {
			t.Fatalf("response %d %s", resp.StatusCode, body)
		}
		if !json.Valid(body) || (method == "tools/call" && !strings.Contains(string(body), `"data":"aW1hZ2U="`)) {
			t.Fatalf("corrupted MCP body %s", body)
		}
	}
}

func TestStreamFlushesAndCancellationReachesUpstream(t *testing.T) {
	cancelled := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Last-Event-ID") != "event-2" {
			t.Error("resume header lost")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		io.WriteString(w, "id: event-3\ndata: {\"jsonrpc\":\"2.0\"}\n\n")
		w.(http.Flusher).Flush()
		<-r.Context().Done()
		close(cancelled)
	}))
	defer upstream.Close()
	u, _ := url.Parse(upstream.URL + "/mcp")
	p, tr := Proxy(u, nil, "")
	defer tr.CloseIdleConnections()
	local := httptest.NewServer(Endpoint(p))
	defer local.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	r, _ := http.NewRequestWithContext(ctx, "GET", local.URL+"/mcp", nil)
	r.Header.Set("Last-Event-ID", "event-2")
	resp, err := http.DefaultClient.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, len("id: event-3\n"))
	if _, err := io.ReadFull(resp.Body, buf); err != nil {
		t.Fatal(err)
	}
	if string(buf) != "id: event-3\n" {
		t.Fatalf("stream %q", buf)
	}
	cancel()
	resp.Body.Close()
	select {
	case <-cancelled:
	case <-time.After(3 * time.Second):
		t.Fatal("upstream not cancelled")
	}
}

func TestProxyPreservesErrorsAndNeverFollowsRedirect(t *testing.T) {
	for _, status := range []int{202, 307, 401, 404, 409, 429, 500} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			u := &url.URL{Scheme: "http", Host: "127.0.0.1:8000", Path: "/mcp"}
			p, tr := Proxy(u, nil, "")
			defer tr.CloseIdleConnections()
			p.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: status, Header: http.Header{"Location": []string{"http://example.invalid/"}}, Body: io.NopCloser(strings.NewReader("body"))}, nil
			})
			w := httptest.NewRecorder()
			p.ServeHTTP(w, httptest.NewRequest("DELETE", "http://local/mcp", nil))
			if w.Code != status || w.Body.String() != "body" {
				t.Fatalf("changed response %d %s", w.Code, w.Body.String())
			}
		})
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestPinnedDialRejectsChangedIdentityAndClosesConnection(t *testing.T) {
	client, server := net.Pipe()
	defer server.Close()
	dial := PinnedDial(func(context.Context, string, string) (net.Conn, error) { return client, nil }, fakeIdentity("different-node", nil), "expected-node")
	if _, err := dial(context.Background(), "tcp", "device:8743"); err == nil {
		t.Fatal("accepted replaced node")
	}
	server.SetReadDeadline(time.Now().Add(time.Second))
	if _, err := server.Read(make([]byte, 1)); err != io.EOF {
		t.Fatalf("unauthorized connection not closed: %v", err)
	}
}
