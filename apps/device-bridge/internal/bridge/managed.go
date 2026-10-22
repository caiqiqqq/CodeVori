package bridge

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"sync"
	"time"

	"tailscale.com/tsnet"
)

type managedConnection struct {
	endpoint  managedEndpoint
	server    *http.Server
	transport *http.Transport
}

func (c *managedConnection) close() { c.server.Close(); c.transport.CloseIdleConnections() }

// Manage is a network-only process. EOF from its owning Main closes every listener.
func Manage(ctx context.Context, c Config, stdin io.Reader, stdout io.Writer) error {
	if err := c.Validate(); err != nil {
		return err
	}
	if err := os.MkdirAll(c.StateDir, 0700); err != nil {
		return errors.New("cannot create bridge state directory")
	}
	s := &tsnet.Server{Dir: c.StateDir, Hostname: c.Hostname, UserLogf: func(string, ...any) {}}
	defer s.Close()
	lc, err := s.LocalClient()
	if err != nil {
		return errors.New("tailnet startup failed")
	}
	lookup := func(ctx context.Context, addr string) (string, error) {
		who, err := lc.WhoIs(ctx, addr)
		if err != nil || who == nil || who.Node == nil {
			return "", errors.New("tailnet identity unavailable")
		}
		return string(who.Node.StableID), nil
	}
	connections := map[string]*managedConnection{}
	var expose *managedConnection
	allowed := map[string]bool{}
	var allowMu sync.RWMutex
	defer func() {
		for _, p := range connections {
			p.close()
		}
		if expose != nil {
			expose.close()
		}
	}()
	lines := make(chan []byte)
	go func() {
		defer close(lines)
		scan := bufio.NewScanner(stdin)
		scan.Buffer(make([]byte, 4096), 64<<10)
		for scan.Scan() {
			line := append([]byte(nil), scan.Bytes()...)
			select {
			case lines <- line:
			case <-ctx.Done():
				return
			}
		}
	}()
	encoder := json.NewEncoder(stdout)
	for {
		var line []byte
		select {
		case <-ctx.Done():
			return nil
		case v, ok := <-lines:
			if !ok {
				return nil
			}
			line = v
		}
		cmd, decodeErr := decodeCommand(line)
		resp := managedResponse{Version: 1, ID: cmd.ID}
		operation := func() error {
			if decodeErr != nil {
				return decodeErr
			}
			requestCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
			defer cancel()
			st, err := lc.Status(requestCtx)
			if err != nil {
				return errors.New("tailnet status unavailable")
			}
			switch cmd.Method {
			case "status":
			case "connect":
				if st.BackendState != "Running" {
					return errors.New("tailnet is not authorized")
				}
				if existing := connections[cmd.NodeID]; existing != nil {
					resp.Connection = &existing.endpoint
					break
				}
				peer, err := findPeer(st, cmd.NodeID)
				if err != nil {
					return err
				}
				if len(peer.TailscaleIPs) == 0 {
					return errors.New("device address unavailable")
				}
				ln, err := net.Listen("tcp4", "127.0.0.1:0")
				if err != nil {
					return errors.New("local listener unavailable")
				}
				secret := make([]byte, 32)
				if _, err := rand.Read(secret); err != nil {
					ln.Close()
					return errors.New("cannot create local credential")
				}
				target := &url.URL{Scheme: "http", Host: net.JoinHostPort(peer.TailscaleIPs[0].String(), "8743"), Path: "/mcp"}
				proxy, tr := Proxy(target, PinnedDial(s.Dial, lookup, cmd.NodeID), "")
				entry := &managedConnection{endpoint: managedEndpoint{cmd.NodeID, "http://" + ln.Addr().String() + "/mcp", hex.EncodeToString(secret)}, transport: tr}
				entry.server = &http.Server{Handler: LocalGateway(entry.endpoint.Token, Endpoint(proxy)), ReadHeaderTimeout: 10 * time.Second, BaseContext: func(net.Listener) context.Context { return ctx }}
				connections[cmd.NodeID] = entry
				resp.Connection = &entry.endpoint
				go entry.server.Serve(ln)
			case "disconnect":
				if entry := connections[cmd.NodeID]; entry != nil {
					entry.close()
					delete(connections, cmd.NodeID)
				}
			case "expose":
				if len(cmd.AllowedNodes) > 0 && st.BackendState != "Running" {
					return errors.New("tailnet is not authorized")
				}
				next := map[string]bool{}
				for _, id := range cmd.AllowedNodes {
					if _, err := findPeer(st, id); err != nil {
						return err
					}
					next[id] = true
				}
				if len(next) == 0 {
					allowMu.Lock()
					allowed = next
					allowMu.Unlock()
					if expose != nil {
						expose.close()
						expose = nil
					}
					break
				}
				if expose == nil {
					ln, err := s.Listen("tcp", ":8743")
					if err != nil {
						return errors.New("tailnet listener unavailable")
					}
					target, _ := url.Parse("http://127.0.0.1:8000/mcp")
					proxy, tr := Proxy(target, nil, "")
					handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						id, err := lookup(r.Context(), r.RemoteAddr)
						allowMu.RLock()
						ok := allowed[id]
						allowMu.RUnlock()
						if err != nil || !ok {
							http.Error(w, "device not authorized", 403)
							return
						}
						proxy.ServeHTTP(w, r)
					})
					expose = &managedConnection{server: &http.Server{Handler: Endpoint(handler), ReadHeaderTimeout: 10 * time.Second, BaseContext: func(net.Listener) context.Context { return ctx }}, transport: tr}
					go expose.server.Serve(ln)
				}
				// 监听成功后才提交授权，失败不能改变对外报告的授权事实。
				allowMu.Lock()
				allowed = next
				allowMu.Unlock()
			case "logout":
				for id, entry := range connections {
					entry.close()
					delete(connections, id)
				}
				if expose != nil {
					expose.close()
					expose = nil
				}
				allowMu.Lock()
				allowed = map[string]bool{}
				allowMu.Unlock()
				if err := lc.Logout(requestCtx); err != nil {
					return errors.New("tailnet logout failed")
				}
				st, err = lc.Status(requestCtx)
				if err != nil {
					return errors.New("tailnet status unavailable")
				}
			}
			allowMu.RLock()
			state := inventory(st, connections, allowed, expose != nil)
			allowMu.RUnlock()
			resp.State = &state
			return nil
		}
		if err := operation(); err != nil {
			resp.Error = err.Error()
		}
		if err := encoder.Encode(resp); err != nil {
			return errors.New("control channel closed")
		}
	}
}
