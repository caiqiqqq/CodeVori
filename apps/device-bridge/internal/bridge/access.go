package bridge

import (
	"crypto/sha256"
	"crypto/subtle"
	"net"
	"net/http"
	"net/netip"
)

func Endpoint(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if len(r.Header.Values("Origin")) != 0 {
			http.Error(w, "browser origins are not supported", http.StatusForbidden)
			return
		}
		if r.URL.EscapedPath() != "/mcp" {
			http.NotFound(w, r)
			return
		}
		if r.Method != http.MethodPost && r.Method != http.MethodGet && r.Method != http.MethodDelete {
			w.Header().Set("Allow", "GET, POST, DELETE")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func AuthorizeNode(lookup IdentityLookup, allowed []string, next http.Handler) http.Handler {
	ids := make(map[string]bool, len(allowed))
	for _, id := range allowed {
		if id != "" {
			ids[id] = true
		}
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, err := lookup(r.Context(), r.RemoteAddr)
		if err != nil || !ids[id] {
			http.Error(w, "device not authorized", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func LocalGateway(token string, next http.Handler) http.Handler {
	expected := sha256.Sum256([]byte("Bearer " + token))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, err := net.SplitHostPort(r.Host)
		ip, ipErr := netip.ParseAddr(host)
		if err != nil || ipErr != nil || !ip.Is4() || !ip.IsLoopback() || len(r.Header.Values("Origin")) != 0 {
			http.Error(w, "local MCP access only", http.StatusForbidden)
			return
		}
		actual := sha256.Sum256([]byte(r.Header.Get("Authorization")))
		if token == "" || len(r.Header.Values("Authorization")) != 1 || subtle.ConstantTimeCompare(actual[:], expected[:]) != 1 {
			http.Error(w, "local MCP authentication required", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}
