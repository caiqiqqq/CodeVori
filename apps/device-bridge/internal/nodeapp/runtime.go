package nodeapp

import (
	"context"
	"errors"
	"net"
	"net/http"
	"path/filepath"
	"time"

	"zcode.local/device-bridge/internal/bridge"
	"zcode.local/device-bridge/internal/executor"
)

func Run(ctx context.Context) error {
	dir, _, err := paths()
	if err != nil {
		return err
	}
	return run(ctx, dir, true)
}
func run(ctx context.Context, dir string, installed bool) error {
	release, err := lock(filepath.Join(dir, "instance.lock"))
	if err != nil {
		return errors.New("node_already_running")
	}
	defer release()
	// 迁移也会写配置，必须在持有实例锁后执行，避免并发启动争抢同一个临时文件。
	c, err := readConfig(dir)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	status := newLocalStatus(dir, cancel)
	status.canUninstall = installed
	if err = status.start(); err != nil {
		return err
	}
	defer status.close()
	startTray(ctx, dir, cancel)
	network, err := newTailnetNetwork(dir, c.Hostname)
	if err != nil {
		status.set("Tailscale 启动失败，请重新启动 CodeVori Node")
		<-ctx.Done()
		return nil
	}
	defer network.server.Close()
	owner := newNetworkController(dir, c, network)
	status.mu.Lock()
	status.network = owner
	status.mu.Unlock()
	handler, err := executor.New(2)
	if err != nil {
		return err
	}
	// 执行器仅监听组网地址；不再拨号到应用配对服务器或注册 WebSocket 中继。
	listener, err := network.server.Listen("tcp", ":8743")
	if err != nil {
		return err
	}
	server := &http.Server{Handler: bridge.Endpoint(owner.authorize(handler)), ReadHeaderTimeout: 10 * time.Second, BaseContext: func(net.Listener) context.Context { return ctx }}
	defer server.Close()
	served := make(chan error, 1)
	go func() { served <- server.Serve(listener) }()
	timer := time.NewTicker(3 * time.Second)
	defer timer.Stop()
	for {
		poll, stop := context.WithTimeout(ctx, 5*time.Second)
		_ = owner.refresh(poll)
		stop()
		select {
		case <-ctx.Done():
			return nil
		case err := <-served:
			if errors.Is(err, http.ErrServerClosed) {
				return nil
			}
			return err
		case <-timer.C:
		}
	}
}
