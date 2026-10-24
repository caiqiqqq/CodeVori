package nodeapp

import (
	"context"
	"errors"
	"net/http"
	"path/filepath"
	"regexp"
	"slices"
	"sync"
)

type networkPeer struct {
	ID, Name, OS string
	Online       bool
}
type networkState struct {
	BackendState, AuthURL, NodeID, DNSName, Tailnet string
	Peers                                           []networkPeer
}
type nodeNetwork interface {
	Status(context.Context) (networkState, error)
	Login(context.Context) error
	WhoIs(context.Context, string) (string, error)
}
type networkView struct {
	networkState
	AllowedNodes []string
}
type networkController struct {
	operations sync.Mutex
	mu         sync.RWMutex
	dir        string
	config     config
	state      networkState
	network    nodeNetwork
}

var stableNodeID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,256}$`)

func validNodeID(id string) bool { return stableNodeID.MatchString(id) }
func newNetworkController(dir string, c config, network nodeNetwork) *networkController {
	return &networkController{dir: dir, config: c, network: network}
}
func (c *networkController) snapshot() networkView {
	c.mu.RLock()
	defer c.mu.RUnlock()
	s := c.state
	s.Peers = slices.Clone(s.Peers)
	return networkView{s, slices.Clone(c.config.AllowedNodes)}
}
func (c *networkController) readNetwork(ctx context.Context) (networkState, error) {
	state, err := c.network.Status(ctx)
	if err != nil {
		state = networkState{BackendState: "Unavailable"}
	}
	c.mu.Lock()
	c.state = state
	c.mu.Unlock()
	return state, err
}
func (c *networkController) refresh(ctx context.Context) error {
	c.operations.Lock()
	defer c.operations.Unlock()
	_, err := c.readNetwork(ctx)
	return err
}
func (c *networkController) login(ctx context.Context) error {
	c.operations.Lock()
	defer c.operations.Unlock()
	state, err := c.readNetwork(ctx)
	if err != nil {
		return err
	}
	if state.BackendState == "Running" || state.AuthURL != "" {
		return nil
	}
	return c.network.Login(ctx)
}
func (c *networkController) grant(ctx context.Context, id string, allow bool) error {
	if !validNodeID(id) {
		return errors.New("invalid_controller")
	}
	c.operations.Lock()
	defer c.operations.Unlock()
	state, err := c.readNetwork(ctx)
	if allow && (err != nil || state.BackendState != "Running" || id == state.NodeID || !slices.ContainsFunc(state.Peers, func(p networkPeer) bool { return p.ID == id })) {
		return errors.New("controller_not_visible")
	}
	c.mu.RLock()
	next := c.config
	next.AllowedNodes = slices.Clone(next.AllowedNodes)
	c.mu.RUnlock()
	next.AllowedNodes = slices.DeleteFunc(next.AllowedNodes, func(value string) bool { return value == id })
	if allow {
		next.AllowedNodes = append(next.AllowedNodes, id)
	}
	if len(next.AllowedNodes) > 256 {
		return errors.New("controller_limit")
	}
	slices.Sort(next.AllowedNodes)
	// 授权和撤销共用串行写入；落盘失败不能改变对外报告或放行下一次请求。
	if err = writeJSON(filepath.Join(c.dir, "connection.json"), next); err != nil {
		return err
	}
	c.mu.Lock()
	c.config = next
	c.mu.Unlock()
	return nil
}
func (c *networkController) authorize(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, err := c.network.WhoIs(r.Context(), r.RemoteAddr)
		c.mu.RLock()
		allowed := err == nil && c.state.BackendState == "Running" && slices.Contains(c.config.AllowedNodes, id)
		c.mu.RUnlock()
		// 每次请求重新校验稳定节点身份和授权，撤销后不能复用旧 MCP 会话继续操作。
		if !allowed {
			http.Error(w, "device not authorized", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}
