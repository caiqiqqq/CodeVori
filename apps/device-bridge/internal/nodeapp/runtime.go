package nodeapp

import (
	"context"
	"errors"
	"github.com/coder/websocket"
	"net/http"
	"path/filepath"
	"strings"
	"time"
	"zcode.local/device-bridge/internal/executor"
	"zcode.local/device-bridge/internal/pairing"
)

func Run(ctx context.Context) error {
	dir, _, e := paths()
	if e != nil {
		return e
	}
	return run(ctx, dir, true)
}
func run(ctx context.Context, dir string, installed bool) error {
	c, e := readConfig(dir)
	if e != nil {
		return e
	}
	release, e := lock(filepath.Join(dir, "instance.lock"))
	if e != nil {
		return errors.New("node_already_running")
	}
	defer release()
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	status := newLocalStatus(dir, cancel)
	status.canUninstall = installed
	if e = status.start(); e != nil {
		return e
	}
	defer status.close()
	handler, e := executor.New(2)
	if e != nil {
		return e
	}
	startTray(ctx, dir, cancel)
	for ctx.Err() == nil {
		status.set("正在连接")
		dialCtx, stop := context.WithTimeout(ctx, 20*time.Second)
		conn, response, err := websocket.Dial(dialCtx, strings.TrimRight(c.ServiceURL, "/")+"/v1/pairs/"+c.ID+"/socket", &websocket.DialOptions{HTTPHeader: http.Header{"Authorization": []string{"Bearer " + c.Token}}})
		stop()
		if err == nil {
			status.set("已连接")
			_ = pairing.ServeExecutor(ctx, conn, handler)
		} else if response != nil && (response.StatusCode == 401 || response.StatusCode == 404) {
			status.set("绑定已撤销，请在主端重新添加电脑")
			<-ctx.Done()
			return nil
		}
		status.set("连接中断，正在重连")
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(3 * time.Second):
		}
	}
	return nil
}
