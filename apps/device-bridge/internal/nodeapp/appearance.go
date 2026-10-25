package nodeapp

import (
	"context"
	_ "embed"
	"os"
	"path/filepath"
	"runtime"
)

// These embedded copies come from packages/desktop/build. Packaging tests guard brand parity.
//
//go:embed assets/icon.png
var nodeIconPNG []byte

//go:embed assets/tray.png
var nodeTrayPNG []byte

//go:embed assets/icon.icns
var nodeIconICNS []byte

type trayAction struct {
	id, label string
	run       func() error
}

func newTrayActions(dir string, installed bool, cancel context.CancelFunc) []trayAction {
	actions := []trayAction{
		{"open", "打开状态", func() error { return openStatus(dir) }},
		{"stop", "停止连接", func() error { cancel(); return nil }},
	}
	if installed {
		actions = append(actions, trayAction{"uninstall", "卸载…", func() error {
			_, binary, err := paths()
			if err != nil {
				return err
			}
			return startDetached(binary, "uninstall")
		}})
	}
	return actions
}

func invokeTrayAction(action trayAction) { go func() { Report(action.run()) }() }

// 安装与更新共用同一图标写入路径，不读取或重写网络身份和授权。
func refreshNodeAppearance(binary string) error {
	var path string
	var data []byte
	switch runtime.GOOS {
	case "darwin":
		path = filepath.Join(filepath.Dir(filepath.Dir(binary)), "Resources", "applet.icns")
		data = nodeIconICNS
	case "linux":
		path = filepath.Join(filepath.Dir(binary), "icon.png")
		data = nodeIconPNG
	default:
		return nil // Windows uses the icon resource in the executable itself.
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}
