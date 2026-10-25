package nodeapp

import (
	"context"
	"os"
	"os/exec"
	"testing"
	"time"
)

type browserStatusNetwork struct{ fakeNetwork }

func (n *browserStatusNetwork) Login(context.Context) error {
	n.logins++
	n.state.BackendState = "Running"
	n.state.AuthURL = ""
	return nil
}

// 浏览器会按响应的 Referrer-Policy 生成 Origin；手写 HTTP 请求无法覆盖此回归。
func TestLocalStatusBrowserForms(t *testing.T) {
	if os.Getenv("CODEVORI_NODE_BROWSER_TEST") != "1" {
		t.Skip("opt-in browser test requires Node and installed Playwright Chromium")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	n := &browserStatusNetwork{fakeNetwork{state: networkState{
		BackendState: "NeedsLogin", NodeID: "self", DNSName: "studio-windows.tailnet-example.ts.net.", Tailnet: "workspace.example",
		Peers: []networkPeer{
			{ID: "controller", Name: "Browser controller", OS: "macOS", Online: true},
			{ID: "offline-controller-with-a-long-stable-node-identifier", Name: "Offline-controller-with-a-long-device-name-for-small-windows", OS: "linux"},
		},
	}}}
	owner := newNetworkController(t.TempDir(), config{Version: 1, Hostname: "node"}, n)
	if err := owner.refresh(ctx); err != nil {
		t.Fatal(err)
	}
	// 与安装端运行时一致，由网络所有者轮询发布登录后的状态。
	polled := make(chan struct{})
	go func() {
		defer close(polled)
		timer := time.NewTicker(3 * time.Second)
		defer timer.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
				_ = owner.refresh(ctx)
			}
		}
	}()
	defer func() { cancel(); <-polled }()
	stopped, stop := context.WithCancel(context.Background())
	defer stop()
	s := newLocalStatus(t.TempDir(), stop)
	s.network = owner
	if err := s.start(); err != nil {
		t.Fatal(err)
	}
	defer s.close()
	cmd := exec.CommandContext(ctx, "node", "../../../../packages/desktop/test/deviceNodeStatus.e2e.mjs")
	cmd.Env = append(os.Environ(), "CODEVORI_STATUS_TEST_URL="+s.state.Address+"/"+s.state.Token)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("browser form regression: %v\n%s", err, out)
	} else {
		t.Log(string(out))
	}
	owner.operations.Lock()
	defer owner.operations.Unlock()
	if n.logins != 1 || len(owner.snapshot().AllowedNodes) != 0 || stopped.Err() == nil {
		t.Fatal("browser actions did not reach their owners")
	}
}
