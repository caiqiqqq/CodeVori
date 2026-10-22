package bridge

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"sort"
	"strings"

	"tailscale.com/ipn/ipnstate"
)

type managedCommand struct {
	ID           string   `json:"id"`
	Method       string   `json:"method"`
	NodeID       string   `json:"nodeId,omitempty"`
	AllowedNodes []string `json:"allowedNodes,omitempty"`
}

type managedPeer struct {
	NodeID    string `json:"nodeId"`
	Name      string `json:"name"`
	OS        string `json:"os"`
	Online    bool   `json:"online"`
	Connected bool   `json:"connected"`
	Allowed   bool   `json:"allowed"`
}

type managedState struct {
	BackendState string        `json:"backendState"`
	AuthURL      string        `json:"authUrl,omitempty"`
	NodeID       string        `json:"nodeId"`
	DNSName      string        `json:"dnsName"`
	LoginName    string        `json:"loginName"`
	Tailnet      string        `json:"tailnet"`
	Exposing     bool          `json:"exposing"`
	Peers        []managedPeer `json:"peers"`
}

type managedEndpoint struct {
	NodeID string `json:"nodeId"`
	URL    string `json:"url"`
	Token  string `json:"token"`
}

type managedResponse struct {
	Version    int              `json:"version"`
	ID         string           `json:"id"`
	State      *managedState    `json:"state,omitempty"`
	Connection *managedEndpoint `json:"connection,omitempty"`
	Error      string           `json:"error,omitempty"`
}

func decodeCommand(line []byte) (managedCommand, error) {
	var c managedCommand
	d := json.NewDecoder(bytes.NewReader(line))
	d.DisallowUnknownFields()
	if err := d.Decode(&c); err != nil {
		return c, errors.New("invalid command")
	}
	var extra any
	if err := d.Decode(&extra); err != io.EOF {
		return c, errors.New("invalid command")
	}
	if c.ID == "" || len(c.ID) > 128 || strings.TrimSpace(c.ID) != c.ID {
		return c, errors.New("invalid command ID")
	}
	switch c.Method {
	case "status", "logout":
	case "connect", "disconnect":
		if c.NodeID == "" {
			return c, errors.New("node ID required")
		}
	case "expose":
		for _, id := range c.AllowedNodes {
			if id == "" {
				return c, errors.New("node ID required")
			}
		}
	default:
		return c, errors.New("unknown command")
	}
	return c, nil
}

func findPeer(st *ipnstate.Status, id string) (*ipnstate.PeerStatus, error) {
	for _, p := range st.Peer {
		if p != nil && string(p.ID) == id {
			return p, nil
		}
	}
	return nil, errors.New("device is not visible in this tailnet")
}

func inventory(st *ipnstate.Status, connections map[string]*managedConnection, allowed map[string]bool, exposing bool) managedState {
	s := managedState{BackendState: st.BackendState, AuthURL: st.AuthURL, Exposing: exposing, Peers: []managedPeer{}}
	if st.Self != nil {
		s.NodeID = string(st.Self.ID)
		s.DNSName = st.Self.DNSName
		s.LoginName = st.User[st.Self.UserID].LoginName
	}
	if st.CurrentTailnet != nil {
		s.Tailnet = st.CurrentTailnet.Name
	}
	for _, p := range st.Peer {
		if p != nil && p.ID != "" {
			s.Peers = append(s.Peers, managedPeer{string(p.ID), p.HostName, p.OS, p.Online, connections[string(p.ID)] != nil, allowed[string(p.ID)]})
		}
	}
	sort.Slice(s.Peers, func(i, j int) bool { return s.Peers[i].NodeID < s.Peers[j].NodeID })
	return s
}
