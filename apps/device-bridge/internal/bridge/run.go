package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"tailscale.com/tsnet"
	"zcode.local/device-bridge/internal/policy"
)

type Config struct {
	Mode, StateDir, Hostname, Target, Listen, Peer, PeerNode string
	AllowedNodes                                             []string
	Port                                                     int
	CommandSlots                                             int
	LocalToken, TargetToken                                  string
}

// Validate runs before starting tsnet or touching its state directory.
func (c Config) Validate() error {
	if !filepath.IsAbs(c.StateDir) {
		return errors.New("state-dir must be an explicit absolute path")
	}
	if c.Hostname == "" || strings.ContainsAny(c.Hostname, " /\\\t\r\n") {
		return errors.New("hostname is required and must be a single node name")
	}
	switch c.Mode {
	case "identity", "manage":
	case "serve", "node":
		if c.Mode == "node" && (c.CommandSlots < 1 || c.CommandSlots > 16) {
			return errors.New("command-slots must be 1..16")
		}
		if _, err := policy.Target(c.Target); err != nil {
			return err
		}
		if c.Port < 1 || c.Port > 65535 {
			return errors.New("port must be 1..65535")
		}
		if len(c.AllowedNodes) == 0 {
			return errors.New("at least one allow-node stable ID is required")
		}
		for _, id := range c.AllowedNodes {
			if id == "" || strings.TrimSpace(id) != id {
				return errors.New("allow-node must be a nonempty stable node ID")
			}
		}
	case "connect":
		if err := policy.LocalListener(c.Listen); err != nil {
			return err
		}
		if err := policy.Peer(c.Peer); err != nil {
			return err
		}
		if c.PeerNode == "" || strings.TrimSpace(c.PeerNode) != c.PeerNode {
			return errors.New("peer-node stable ID is required")
		}
		if len(c.LocalToken) < 32 || strings.ContainsAny(c.LocalToken, " \t\r\n") {
			return errors.New("ZCODE_DEVICE_BRIDGE_TOKEN must contain at least 32 non-whitespace characters")
		}
	default:
		return errors.New("mode must be identity, serve or connect")
	}
	if strings.ContainsAny(c.TargetToken, "\r\n") {
		return errors.New("invalid target token")
	}
	return nil
}

type ready struct {
	Event   string `json:"event"`
	Version int    `json:"version"`
	Mode    string `json:"mode"`
	NodeID  string `json:"nodeId"`
	DNSName string `json:"dnsName"`
	URL     string `json:"url"`
}

// Run owns only transport resources. It never owns an Agent, task, or MCP session.
func Run(ctx context.Context, c Config, stdout, stderr io.Writer) error {
	if err := c.Validate(); err != nil {
		return err
	}
	if err := os.MkdirAll(c.StateDir, 0700); err != nil {
		return errors.New("cannot create bridge state directory")
	}
	s := &tsnet.Server{
		Dir:      c.StateDir,
		Hostname: c.Hostname,
		UserLogf: func(format string, args ...any) { fmt.Fprintf(stderr, format+"\n", args...) },
	}
	defer s.Close()
	status, err := s.Up(ctx)
	if err != nil {
		return errors.New("tailnet startup failed or was cancelled")
	}
	if status.Self == nil || status.Self.ID == "" {
		return errors.New("tailnet node identity unavailable")
	}
	if c.Mode == "identity" {
		return json.NewEncoder(stdout).Encode(struct {
			Event   string `json:"event"`
			Version int    `json:"version"`
			NodeID  string `json:"nodeId"`
			DNSName string `json:"dnsName"`
		}{"identity", 1, string(status.Self.ID), status.Self.DNSName})
	}
	lc, err := s.LocalClient()
	if err != nil {
		return errors.New("tailnet identity service unavailable")
	}
	lookup := func(ctx context.Context, addr string) (string, error) {
		who, err := lc.WhoIs(ctx, addr)
		if err != nil || who == nil || who.Node == nil {
			return "", errors.New("tailnet identity unavailable")
		}
		return string(who.Node.StableID), nil
	}

	var listener net.Listener
	var handler http.Handler
	var transport *http.Transport
	var endpoint string
	if c.Mode == "serve" || c.Mode == "node" {
		listener, err = s.Listen("tcp", ":"+strconv.Itoa(c.Port))
		if err != nil {
			return errors.New("cannot bind tailnet listener")
		}
		target, _ := policy.Target(c.Target)
		proxy, tr := Proxy(target, nil, c.TargetToken)
		transport = tr
		handler = Endpoint(AuthorizeNode(lookup, c.AllowedNodes, proxy))
		host := strings.TrimSuffix(status.Self.DNSName, ".")
		if host == "" && len(status.TailscaleIPs) > 0 {
			host = status.TailscaleIPs[0].String()
		}
		endpoint = "http://" + net.JoinHostPort(host, strconv.Itoa(c.Port)) + "/mcp"
	} else {
		listener, err = net.Listen("tcp4", c.Listen)
		if err != nil {
			return errors.New("cannot bind local listener")
		}
		target := &url.URL{Scheme: "http", Host: c.Peer, Path: "/mcp"}
		proxy, tr := Proxy(target, PinnedDial(s.Dial, lookup, c.PeerNode), "")
		transport = tr
		handler = LocalGateway(c.LocalToken, Endpoint(proxy))
		endpoint = "http://" + listener.Addr().String() + "/mcp"
	}
	defer listener.Close()
	defer transport.CloseIdleConnections()
	server := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 20,
		BaseContext:       func(net.Listener) context.Context { return ctx },
	}
	defer server.Close()
	if err := json.NewEncoder(stdout).Encode(ready{"ready", 1, c.Mode, string(status.Self.ID), status.Self.DNSName, endpoint}); err != nil {
		return errors.New("cannot publish bridge readiness")
	}
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	select {
	case <-ctx.Done():
		return nil
	case err := <-done:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return errors.New("bridge listener failed")
	}
}
