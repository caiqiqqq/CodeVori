// Package nodeapp owns local installation, connection identity and user-session lifecycle only.
package nodeapp

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"syscall"
	"time"
)

// ServiceURL is retained only in legacy updater manifests; runtime never dials it.
var ServiceURL = "https://aimodetest.cn/device-node"

type config struct {
	Version      int      `json:"version"`
	Hostname     string   `json:"hostname"`
	AllowedNodes []string `json:"allowedNodes"`
}

func defaultConfig() config {
	name, _ := os.Hostname()
	name = regexp.MustCompile(`[^a-z0-9-]`).ReplaceAllString(strings.ToLower(name), "-")
	if len(name) > 40 {
		name = name[:40]
	}
	if name == "" {
		name = "computer"
	}
	return config{Version: 1, Hostname: "codevori-node-" + name, AllowedNodes: []string{}}
}

func paths() (string, string, error) {
	dir, e := os.UserConfigDir()
	if e != nil {
		return "", "", e
	}
	if runtime.GOOS == "windows" && os.Getenv("LOCALAPPDATA") != "" {
		dir = os.Getenv("LOCALAPPDATA")
	}
	dir = filepath.Join(dir, "CodeVoriNode")
	binary := filepath.Join(dir, "CodeVoriNode")
	if runtime.GOOS == "windows" {
		binary += ".exe"
	}
	if runtime.GOOS == "darwin" {
		home, e := os.UserHomeDir()
		if e != nil {
			return "", "", e
		}
		binary = filepath.Join(home, "Applications", "CodeVori Node.app", "Contents", "MacOS", "CodeVoriNode")
	}
	return dir, binary, nil
}
func writeJSON(path string, v any) error {
	b, e := json.Marshal(v)
	if e != nil {
		return e
	}
	if e = os.MkdirAll(filepath.Dir(path), 0700); e != nil {
		return e
	}
	if e = os.WriteFile(path+".tmp", b, 0600); e != nil {
		return e
	}
	return os.Rename(path+".tmp", path)
}

var secretPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)

func readConfig(dir string) (config, error) {
	var c config
	b, e := os.ReadFile(filepath.Join(dir, "connection.json"))
	if e != nil {
		return c, e
	}
	if json.Unmarshal(b, &c) != nil {
		return c, errors.New("invalid_node_configuration")
	}
	if c.Version == 0 {
		var legacy struct {
			ServiceURL string `json:"serviceUrl"`
			ID         string `json:"id"`
			Token      string `json:"nodeToken"`
		}
		if json.Unmarshal(b, &legacy) != nil || !secretPattern.MatchString(legacy.ID) || !secretPattern.MatchString(legacy.Token) {
			return c, errors.New("invalid_node_configuration")
		}
		// 旧配对凭据不能授权 Tailscale 成员；迁移只保留安装位置，等待用户重新入网和授权。
		c = defaultConfig()
		if e = writeJSON(filepath.Join(dir, "connection.json"), c); e != nil {
			return c, e
		}
	}
	if c.Version != 1 || !regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`).MatchString(c.Hostname) || len(c.AllowedNodes) > 256 {
		return c, errors.New("invalid_node_configuration")
	}
	seen := map[string]bool{}
	for _, id := range c.AllowedNodes {
		if !validNodeID(id) || seen[id] {
			return c, errors.New("invalid_node_configuration")
		}
		seen[id] = true
	}
	return c, nil
}

func Install(ctx context.Context, executable string) error {
	dir, binary, e := paths()
	if e != nil {
		return e
	}
	if e = os.MkdirAll(dir, 0700); e != nil {
		return e
	}
	releaseInstall, e := lock(filepath.Join(dir, "installation.lock"))
	if e != nil {
		return errors.New("installation_already_running")
	}
	defer releaseInstall()
	_, statErr := os.Stat(filepath.Join(dir, "connection.json"))
	reinstall := statErr == nil
	if statErr != nil && !os.IsNotExist(statErr) {
		return statErr
	}
	if !confirm("安装 CodeVori Node", "安装后，请在状态页登录 Tailscale，加入主端所在网络，并选择允许控制此电脑的主端。是否安装？") {
		return nil
	}
	c := defaultConfig()
	if e = os.MkdirAll(filepath.Dir(binary), 0700); e != nil {
		return e
	}
	var releasePrevious func()
	if reinstall {
		releasePrevious, e = stopAndLockNode(ctx, dir)
		if e != nil {
			return e
		}
		defer func() {
			if releasePrevious != nil {
				releasePrevious()
			}
		}()
		// 先停止网络所有者，再读取授权，避免重装覆盖停止前刚保存的变更。
		c, e = readConfig(dir)
		if e != nil {
			return e
		}
	}
	if filepath.Clean(executable) != filepath.Clean(binary) {
		source, e := os.Open(executable)
		if e != nil {
			return e
		}
		defer source.Close()
		target, e := os.OpenFile(binary+".new", os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
		if e != nil {
			return e
		}
		_, copyErr := io.Copy(target, source)
		closeErr := target.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
		if e = os.Rename(binary+".new", binary); e != nil {
			return errors.New("installation_binary_busy")
		}
	}
	if e = writeJSON(filepath.Join(dir, "connection.json"), c); e != nil {
		return e
	}
	if e = autostart(binary, true); e != nil {
		return errors.New("login_startup_configuration_failed")
	}
	if releasePrevious != nil {
		releasePrevious()
		releasePrevious = nil
	}
	if e = startDetached(binary, "agent"); e != nil {
		return errors.New("node_start_failed")
	}
	return Open()
}
func Open() error {
	dir, binary, e := paths()
	if e != nil {
		return e
	}
	if openStatus(dir) == nil {
		return nil
	}
	if e = startDetached(binary, "agent"); e != nil {
		return e
	}
	for range 30 {
		if openStatus(dir) == nil {
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return errors.New("node_status_unavailable")
}
func Uninstall() error {
	dir, binary, e := paths()
	if e != nil {
		return e
	}
	if !confirm("卸载 CodeVori Node", "是否停止连接并移除此电脑上的 CodeVori Node？") {
		return nil
	}
	if e = autostart(binary, false); e != nil {
		return e
	}
	_ = stopLocal(dir)
	// 删除本地身份与授权，避免卸载后残留配置恢复控制权限。
	_ = os.Remove(filepath.Join(dir, "connection.json"))
	_ = os.Remove(filepath.Join(dir, "installation.json"))
	return removeInstallation(dir, binary)
}
func startDetached(binary string, args ...string) error {
	cmd := exec.Command(binary, args...)
	detach(cmd)
	if e := cmd.Start(); e != nil {
		return e
	}
	return cmd.Process.Release()
}
func Main(args []string) error {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if len(args) > 0 {
		switch args[0] {
		case "update":
			if len(args) != 1 {
				return errors.New("invalid_node_command")
			}
			return CheckForUpdate(ctx)
		case "apply-update":
			if len(args) != 2 {
				return errors.New("invalid_node_command")
			}
			return ApplyUpdate(ctx, args[1])
		case "agent":
			if len(args) == 1 {
				return Run(ctx)
			}
			if len(args) == 3 && args[1] == "--state-dir" {
				return runLocal(ctx, args[2])
			}
			return errors.New("invalid_node_command")
		case "uninstall":
			return Uninstall()
		case "open":
			return Open()
		default:
			return errors.New("invalid_node_command")
		}
	}
	executable, e := os.Executable()
	if e != nil {
		return e
	}
	_, binary, e := paths()
	if e != nil {
		return e
	}
	if filepath.Clean(binary) == filepath.Clean(executable) {
		return Open()
	}
	return Install(ctx, executable)
}
func Report(err error) {
	if err != nil {
		messages := map[string]string{
			"node_update_unavailable":            "暂时无法检查更新，请稍后再试。",
			"invalid_update_source":              "此客户端的更新来源不匹配，请通过主端重新下载安装。",
			"invalid_update_manifest":            "更新信息无效，请稍后再试。",
			"node_update_integrity_failed":       "更新文件校验失败，已取消更新，原客户端仍可使用。",
			"installation_already_running":       "另一个安装程序正在运行，请先完成该安装。",
			"previous_node_still_stopping":       "原连接仍在停止，请稍后再次安装。",
			"installation_binary_busy":           "应用仍在运行，请退出 CodeVori Node 后再次安装。",
			"login_startup_configuration_failed": "无法配置登录自启，请检查系统权限后重新安装。",
			"node_already_running":               "CodeVori Node 已在运行。请从托盘或已安装的应用打开状态页。",
		}
		text := messages[err.Error()]
		if text == "" {
			text = "操作未完成，请检查网络和系统权限，或通过主端重新下载安装程序。"
		}
		notify("CodeVori Node", text)
	}
}
