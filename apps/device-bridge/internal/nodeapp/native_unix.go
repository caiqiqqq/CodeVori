//go:build !windows

package nodeapp

import (
	"context"
	"encoding/xml"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
)

func notify(title, text string) {
	if runtime.GOOS == "darwin" {
		_ = exec.Command("osascript", "-e", `on run argv
display dialog (item 2 of argv) with title (item 1 of argv) buttons {"好"} default button 1
end run`, title, text).Run()
	} else {
		_ = exec.Command("zenity", "--info", "--title", title, "--text", text).Run()
	}
}
func confirm(title, text string) bool {
	if runtime.GOOS == "darwin" {
		script := "on run argv\ndisplay dialog (item 2 of argv) with title (item 1 of argv) buttons {\"取消\",\"安装 / 确认\"} default button 2\nend run"
		return exec.Command("osascript", "-e", script, title, text).Run() == nil
	}
	if _, e := exec.LookPath("zenity"); e == nil {
		return exec.Command("zenity", "--question", "--title", title, "--text", text).Run() == nil
	}
	if _, e := exec.LookPath("kdialog"); e == nil {
		return exec.Command("kdialog", "--title", title, "--yesno", text).Run() == nil
	}
	return browserConfirm(title, text)
}
func startTray(context.Context, string, context.CancelFunc) {}
func detach(cmd *exec.Cmd)                                  { cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true} }
func openURL(url string) error {
	tool := "xdg-open"
	if runtime.GOOS == "darwin" {
		tool = "open"
	}
	cmd := exec.Command(tool, url)
	if e := cmd.Start(); e != nil {
		return e
	}
	return cmd.Wait()
}
func escapedXML(v string) string {
	var b strings.Builder
	_ = xml.EscapeText(&b, []byte(v))
	return b.String()
}
func autostart(binary string, enabled bool) error {
	home, e := os.UserHomeDir()
	if e != nil {
		return e
	}
	if runtime.GOOS == "darwin" {
		file := filepath.Join(home, "Library", "LaunchAgents", "app.codevori.node.plist")
		if !enabled {
			_ = os.Remove(file)
			return nil
		}
		if e = os.MkdirAll(filepath.Dir(file), 0700); e != nil {
			return e
		}
		plist := `<?xml version="1.0"?><plist version="1.0"><dict><key>Label</key><string>app.codevori.node</string><key>ProgramArguments</key><array><string>` + escapedXML(binary) + `</string><string>agent</string></array><key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict></dict></plist>`
		if e = os.WriteFile(file, []byte(plist), 0600); e != nil {
			return e
		}
		return installMacLauncher(binary)
	}
	cfg, e := os.UserConfigDir()
	if e != nil {
		return e
	}
	file := filepath.Join(cfg, "autostart", "codevori-node.desktop")
	if !enabled {
		_ = os.Remove(file)
		return nil
	}
	if strings.ContainsAny(binary, "\r\n") {
		return fmt.Errorf("invalid_installation_path")
	}
	if e = os.MkdirAll(filepath.Dir(file), 0700); e != nil {
		return e
	}
	quote := strings.NewReplacer("\\", "\\\\", "\"", "\\\"", "%", "%%", "`", "\\`", "$", "\\$").Replace(binary)
	data := "[Desktop Entry]\nType=Application\nName=CodeVori Node\nExec=\"" + quote + "\" agent\nTerminal=false\n"
	if e = os.WriteFile(file, []byte(data), 0600); e != nil {
		return e
	}
	appDir := filepath.Join(home, ".local", "share", "applications")
	if e = os.MkdirAll(appDir, 0700); e != nil {
		return e
	}
	if e = os.WriteFile(filepath.Join(appDir, "codevori-node.desktop"), []byte(strings.Replace(data, " agent\n", " open\n", 1)), 0644); e != nil {
		return e
	}
	protocol := strings.Replace(data, " agent\n", " link %u\n", 1) + "NoDisplay=true\nMimeType=x-scheme-handler/codevori-node;\n"
	if e = os.WriteFile(filepath.Join(appDir, "codevori-node-link.desktop"), []byte(protocol), 0644); e != nil {
		return e
	}
	_ = exec.Command("xdg-mime", "default", "codevori-node-link.desktop", "x-scheme-handler/codevori-node").Run()
	return nil
}
func lock(path string) (func(), error) {
	f, e := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return nil, e
	}
	if e = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); e != nil {
		f.Close()
		return nil, e
	}
	return func() { _ = f.Close() }, nil
}
func removeInstallation(dir, binary string) error {
	home, _ := os.UserHomeDir()
	if runtime.GOOS == "darwin" {
		_ = os.RemoveAll(filepath.Join(home, "Applications", "CodeVori Node.app"))
	} else {
		_ = os.Remove(filepath.Join(home, ".local", "share", "applications", "codevori-node.desktop"))
		_ = os.Remove(filepath.Join(home, ".local", "share", "applications", "codevori-node-link.desktop"))
	}
	return os.RemoveAll(dir)
}
