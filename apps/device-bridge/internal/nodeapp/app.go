// Package nodeapp owns local installation, connection identity and user-session lifecycle only.
package nodeapp

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"syscall"
	"time"

	"zcode.local/device-bridge/internal/pairing"
)

// ServiceURL is set independently for the published installers by the packaging command.
var ServiceURL = "https://aimodetest.cn/device-node"

type config struct {
	ServiceURL string `json:"serviceUrl"`
	ID         string `json:"id"`
	Token      string `json:"nodeToken"`
}
type invitation struct {
	ServiceURL string `json:"serviceUrl"`
	Invitation string `json:"invitation"`
	Nonce      string `json:"nonce,omitempty"`
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
func readConfig(dir string) (config, error) {
	var c config
	b, e := os.ReadFile(filepath.Join(dir, "connection.json"))
	if e != nil {
		return c, e
	}
	if json.Unmarshal(b, &c) != nil || pairing.ValidateURL(c.ServiceURL) != nil || !secretPattern.MatchString(c.Token) || !secretPattern.MatchString(c.ID) {
		return c, errors.New("invalid_node_configuration")
	}
	return c, nil
}

var secretPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
var installerPattern = regexp.MustCompile(`^CodeVoriSetup-([A-Za-z0-9_-]{43})(?: \([0-9]+\))?\.exe$`)

func loadInvitation(executable string) (invitation, error) {
	var i invitation
	if match := installerPattern.FindStringSubmatch(filepath.Base(executable)); len(match) == 2 {
		i = invitation{ServiceURL: ServiceURL, Invitation: match[1]}
	} else {
		file := filepath.Join(filepath.Dir(executable), "invitation.json")
		if runtime.GOOS == "darwin" {
			file = filepath.Join(filepath.Dir(executable), "..", "Resources", "invitation.json")
		}
		b, e := os.ReadFile(file)
		if e != nil {
			return i, errors.New("installation_invitation_missing")
		}
		if json.Unmarshal(b, &i) != nil {
			return i, errors.New("invalid_installation_invitation")
		}
	}
	if pairing.ValidateURL(i.ServiceURL) != nil || !secretPattern.MatchString(i.Invitation) {
		return i, errors.New("invalid_installation_invitation")
	}
	return i, nil
}
func Install(ctx context.Context, executable string) error {
	i, e := loadInvitation(executable)
	if e != nil {
		return e
	}
	return installWithInvitation(ctx, executable, i)
}
func installWithInvitation(ctx context.Context, executable string, i invitation) error {
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
	_, previousErr := readConfig(dir)
	reinstall := previousErr == nil
	message := "安装后，此电脑将允许配对的主端执行命令和操作桌面。是否安装并连接？"
	if reinstall {
		message = "此电脑已安装 CodeVori Node。重新配对将断开原主端，是否继续？"
	}
	if !confirm("安装 CodeVori Node", message+"\n\n服务："+i.ServiceURL) {
		return nil
	}
	pending := filepath.Join(dir, "installation.json")
	var previous invitation
	if b, e := os.ReadFile(pending); e == nil && json.Unmarshal(b, &previous) == nil && previous.Invitation == i.Invitation && secretPattern.MatchString(previous.Nonce) {
		i.Nonce = previous.Nonce
	} else {
		b := make([]byte, 32)
		if _, e = rand.Read(b); e != nil {
			return e
		}
		i.Nonce = base64.RawURLEncoding.EncodeToString(b)
	}
	if e = writeJSON(pending, i); e != nil {
		return e
	}
	body, _ := json.Marshal(map[string]string{"invitation": i.Invitation, "nonce": i.Nonce})
	req, e := http.NewRequestWithContext(ctx, "POST", strings.TrimRight(i.ServiceURL, "/")+"/v1/redeem", bytes.NewReader(body))
	if e != nil {
		return e
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, e := client.Do(req)
	if e != nil {
		return errors.New("pairing_service_unavailable")
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return errors.New("installation_invitation_expired_or_unavailable")
	}
	var c config
	if json.NewDecoder(io.LimitReader(response.Body, 4096)).Decode(&c) != nil || !secretPattern.MatchString(c.ID) || !secretPattern.MatchString(c.Token) {
		return errors.New("invalid_registration_response")
	}
	c.ServiceURL = i.ServiceURL
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
	_ = os.Remove(pending)
	notify("CodeVori Node", "已安装并启动。主端将自动显示此电脑。可通过已安装的 CodeVori Node 查看状态或停止连接。")
	return nil
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
	// 先删除控制凭据，避免残留二进制被再次启动时恢复绑定。
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
		case "link":
			if len(args) != 2 {
				return errors.New("invalid_installation_invitation")
			}
			i, e := parseAppLink(args[1])
			if e != nil {
				return e
			}
			executable, e := os.Executable()
			if e != nil {
				return e
			}
			return installWithInvitation(ctx, executable, i)
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
			"node_update_unavailable":                        "暂时无法检查更新，请稍后再试。",
			"invalid_update_source":                          "此客户端的更新来源不匹配，请通过主端重新下载安装。",
			"invalid_update_manifest":                        "更新信息无效，请稍后再试。",
			"node_update_integrity_failed":                   "更新文件校验失败，已取消更新，原客户端仍可使用。",
			"installation_invitation_missing":                "请通过主端生成的专属链接下载安装程序。",
			"installation_invitation_expired_or_unavailable": "安装链接已过期或不可用，请在主端重新添加电脑。",
			"pairing_service_unavailable":                    "暂时无法连接配对服务，请检查网络后再次打开安装程序。",
			"installation_already_running":                   "另一个安装程序正在运行，请先完成该安装。",
			"previous_node_still_stopping":                   "原连接仍在停止，请稍后再次安装。",
			"installation_binary_busy":                       "应用仍在运行，请退出 CodeVori Node 后再次安装。",
			"login_startup_configuration_failed":             "无法配置登录自启，请检查系统权限后重新安装。",
			"node_already_running":                           "CodeVori Node 已在运行。请从托盘或已安装的应用打开状态页。",
		}
		text := messages[err.Error()]
		if text == "" {
			text = "操作未完成，请检查网络和系统权限，或通过主端重新下载安装程序。"
		}
		notify("CodeVori Node", text)
	}
}
