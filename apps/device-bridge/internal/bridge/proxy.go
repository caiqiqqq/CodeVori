package bridge

import (
	"context"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"
)

type DialFunc func(context.Context, string, string) (net.Conn, error)
type IdentityLookup func(context.Context, string) (string, error)

// PinnedDial checks the actual connected peer, rather than trusting a DNS label.
func PinnedDial(dial DialFunc, lookup IdentityLookup, expected string) DialFunc {
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		conn, err := dial(ctx, network, addr)
		if err != nil {
			return nil, errors.New("device connection failed")
		}
		id, err := lookup(ctx, conn.RemoteAddr().String())
		if err != nil || id == "" || id != expected {
			conn.Close()
			return nil, errors.New("device identity verification failed")
		}
		return conn, nil
	}
}

// Proxy preserves MCP bodies and streams; it has no JSON-RPC or task state.
func Proxy(target *url.URL, dial DialFunc, upstreamToken string) (*httputil.ReverseProxy, *http.Transport) {
	if dial == nil {
		dial = (&net.Dialer{Timeout: 30 * time.Second}).DialContext
	}
	transport := &http.Transport{
		DialContext: dial,
		// 不复用连接，避免 net/http 对旧连接上的可重放请求自动重试。
		DisableKeepAlives:      true,
		DisableCompression:     true,
		ResponseHeaderTimeout:  30 * time.Second,
		MaxResponseHeaderBytes: 1 << 20,
	}
	proxy := &httputil.ReverseProxy{
		Transport:     transport,
		FlushInterval: -1,
		ErrorLog:      log.New(io.Discard, "", 0),
		Rewrite: func(p *httputil.ProxyRequest) {
			p.Out.URL.Scheme = target.Scheme
			p.Out.URL.Host = target.Host
			p.Out.URL.Path = target.Path
			p.Out.URL.RawPath = target.RawPath
			p.Out.Host = target.Host
			p.Out.Header.Del("Authorization")
			if upstreamToken != "" {
				p.Out.Header.Set("Authorization", "Bearer "+upstreamToken)
			}
			for key := range p.Out.Header {
				lower := strings.ToLower(key)
				if lower == "forwarded" || strings.HasPrefix(lower, "x-forwarded-") {
					p.Out.Header.Del(key)
				}
			}
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			http.Error(w, "device MCP connection failed; execution outcome may be unknown", http.StatusBadGateway)
		},
	}
	return proxy, transport
}
