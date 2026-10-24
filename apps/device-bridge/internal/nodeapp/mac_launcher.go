package nodeapp

import (
	"io"
	"os"
	"os/exec"
	"path/filepath"
)

const macLauncherSource = `on run
set runner to (POSIX path of (path to me)) & "Contents/MacOS/CodeVoriNode"
do shell script (quoted form of runner) & " open >/dev/null 2>&1 &"
end run
on open location linkURL
set runner to (POSIX path of (path to me)) & "Contents/MacOS/CodeVoriNode"
do shell script (quoted form of runner) & " link " & (quoted form of linkURL) & " >/dev/null 2>&1 &"
end open location`

// AppleScript's native URL event handler hands links to the Go process as an argument.
// A plain Go .app does not receive an "open location" AppleEvent through os.Args.
func installMacLauncher(binary string) error {
	appDir := filepath.Dir(filepath.Dir(filepath.Dir(binary)))
	temp, e := os.MkdirTemp(filepath.Dir(appDir), ".codevori-launcher-")
	if e != nil {
		return e
	}
	defer os.RemoveAll(temp)
	app := filepath.Join(temp, "CodeVori Node.app")
	cmd := exec.Command("osacompile", "-o", app)
	input, e := cmd.StdinPipe()
	if e != nil {
		return e
	}
	if e = cmd.Start(); e != nil {
		return e
	}
	_, writeErr := io.WriteString(input, macLauncherSource)
	_ = input.Close()
	if e = cmd.Wait(); e != nil {
		return e
	}
	if writeErr != nil {
		return writeErr
	}
	from, e := os.Open(binary)
	if e != nil {
		return e
	}
	defer from.Close()
	dest, e := os.OpenFile(filepath.Join(app, "Contents", "MacOS", "CodeVoriNode"), os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
	if e != nil {
		return e
	}
	_, e = io.Copy(dest, from)
	closeErr := dest.Close()
	if e != nil {
		return e
	}
	if closeErr != nil {
		return closeErr
	}
	plist := filepath.Join(app, "Contents", "Info.plist")
	commands := []string{
		"Delete :CFBundleIdentifier", "Add :CFBundleIdentifier string app.codevori.node",
		"Delete :LSUIElement", "Add :LSUIElement bool true",
		"Add :CFBundleURLTypes array", "Add :CFBundleURLTypes:0 dict",
		"Add :CFBundleURLTypes:0:CFBundleURLSchemes array", "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string codevori-node",
	}
	for _, command := range commands {
		err := exec.Command("/usr/libexec/PlistBuddy", "-c", command, plist).Run()
		if err != nil && command[:6] != "Delete" {
			return err
		}
	}
	backup := appDir + ".previous"
	_ = os.RemoveAll(backup)
	if e = os.Rename(appDir, backup); e != nil {
		return e
	}
	if e = os.Rename(app, appDir); e != nil {
		_ = os.Rename(backup, appDir)
		return e
	}
	_ = os.RemoveAll(backup)
	// Register immediately; do not require a manual first launch for the URL handler.
	_ = exec.Command("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister", "-f", appDir).Run()
	return nil
}
