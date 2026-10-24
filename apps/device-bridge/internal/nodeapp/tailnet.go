package nodeapp

import (
	"context"
	"errors"
	"path/filepath"
	"sort"

	localclient "tailscale.com/client/local"
	"tailscale.com/tsnet"
)

type tailnetNetwork struct {
	server *tsnet.Server
	client *localclient.Client
}

func newTailnetNetwork(dir, hostname string) (*tailnetNetwork, error) {
	s := &tsnet.Server{Dir: filepath.Join(dir, "tailnet"), Hostname: hostname, UserLogf: func(string, ...any) {}, Logf: func(string, ...any) {}}
	lc, err := s.LocalClient()
	if err != nil {
		_ = s.Close()
		return nil, err
	}
	return &tailnetNetwork{s, lc}, nil
}
func (n *tailnetNetwork) Status(ctx context.Context) (networkState, error) {
	st, err := n.client.Status(ctx)
	if err != nil {
		return networkState{}, err
	}
	state := networkState{BackendState: st.BackendState, AuthURL: st.AuthURL, Peers: []networkPeer{}}
	if st.Self != nil {
		state.NodeID = string(st.Self.ID)
		state.DNSName = st.Self.DNSName
	}
	if st.CurrentTailnet != nil {
		state.Tailnet = st.CurrentTailnet.Name
	}
	for _, p := range st.Peer {
		if p != nil && p.ID != "" {
			state.Peers = append(state.Peers, networkPeer{string(p.ID), p.HostName, p.OS, p.Online})
		}
	}
	sort.Slice(state.Peers, func(i, j int) bool { return state.Peers[i].ID < state.Peers[j].ID })
	return state, nil
}
func (n *tailnetNetwork) Login(ctx context.Context) error { return n.client.StartLoginInteractive(ctx) }
func (n *tailnetNetwork) WhoIs(ctx context.Context, addr string) (string, error) {
	who, err := n.client.WhoIs(ctx, addr)
	if err != nil || who == nil || who.Node == nil {
		return "", errors.New("network_identity_unavailable")
	}
	return string(who.Node.StableID), nil
}
