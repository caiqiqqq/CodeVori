//go:build windows

package nodeapp

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"
)

var user32 = syscall.NewLazyDLL("user32.dll")

func message(title, text string, flags uintptr) uintptr {
	t, _ := syscall.UTF16PtrFromString(title)
	v, _ := syscall.UTF16PtrFromString(text)
	n, _, _ := user32.NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(v)), uintptr(unsafe.Pointer(t)), flags)
	return n
}
func confirm(title, text string) bool { return message(title, text, 0x24) == 6 }
func notify(title, text string)       { message(title, text, 0x40) }
func detach(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x00000200 | 0x00000008}
}
func runHidden(name string, args ...string) error {
	c := exec.Command(name, args...)
	c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return c.Run()
}
func openURL(url string) error { return runHidden("rundll32.exe", "url.dll,FileProtocolHandler", url) }
func autostart(binary string, enabled bool) error {
	run := `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
	uninstall := `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\CodeVoriNode`
	protocol := `HKCU\Software\Classes\codevori-node`
	if !enabled {
		_ = runHidden("reg.exe", "delete", protocol, "/f")
		_ = runHidden("reg.exe", "delete", run, "/v", "CodeVoriNode", "/f")
		_ = runHidden("reg.exe", "delete", uninstall, "/f")
		return nil
	}
	if e := runHidden("reg.exe", "add", run, "/v", "CodeVoriNode", "/t", "REG_SZ", "/d", `"`+binary+`" agent`, "/f"); e != nil {
		return e
	}
	for _, args := range [][]string{
		{"add", protocol, "/ve", "/t", "REG_SZ", "/d", "URL:CodeVori Node", "/f"},
		{"add", protocol, "/v", "URL Protocol", "/t", "REG_SZ", "/d", "", "/f"},
		{"add", protocol + `\shell\open\command`, "/ve", "/t", "REG_SZ", "/d", `"` + binary + `" link "%1"`, "/f"},
	} {
		if e := runHidden("reg.exe", args...); e != nil {
			return e
		}
	}
	values := map[string]string{"DisplayName": "CodeVori Node", "Publisher": "CodeVori", "InstallLocation": filepath.Dir(binary), "UninstallString": `"` + binary + `" uninstall`}
	for key, value := range values {
		if e := runHidden("reg.exe", "add", uninstall, "/v", key, "/t", "REG_SZ", "/d", value, "/f"); e != nil {
			return e
		}
	}
	// 快捷方式只包含固定安装路径，不拼入邀请或设备凭据。
	menu := filepath.Join(os.Getenv("APPDATA"), "Microsoft", "Windows", "Start Menu", "Programs", "CodeVori Node.lnk")
	quote := func(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }
	script := `$s=(New-Object -ComObject WScript.Shell).CreateShortcut(` + quote(menu) + `);$s.TargetPath=` + quote(binary) + `;$s.Save()`
	return runHidden("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script)
}
func lock(path string) (func(), error) {
	p, e := syscall.UTF16PtrFromString(path)
	if e != nil {
		return nil, e
	}
	h, e := syscall.CreateFile(p, syscall.GENERIC_READ|syscall.GENERIC_WRITE, 0, nil, syscall.OPEN_ALWAYS, syscall.FILE_ATTRIBUTE_NORMAL, 0)
	if e != nil {
		return nil, e
	}
	return func() { _ = syscall.CloseHandle(h) }, nil
}
func removeInstallation(dir, binary string) error {
	_ = os.Remove(filepath.Join(os.Getenv("APPDATA"), "Microsoft", "Windows", "Start Menu", "Programs", "CodeVori Node.lnk"))
	// Windows 不允许删除正在运行的卸载器；独立系统进程在卸载器退出后清理固定目录。
	script := `Start-Sleep -Seconds 2; Remove-Item -LiteralPath '` + strings.ReplaceAll(dir, "'", "''") + `' -Recurse -Force`
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script)
	detach(cmd)
	if e := cmd.Start(); e != nil {
		return e
	}
	return cmd.Process.Release()
}
