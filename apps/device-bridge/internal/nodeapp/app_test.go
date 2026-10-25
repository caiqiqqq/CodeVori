package nodeapp

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
)

func TestInstallationIdentityAndPrivateConfig(t *testing.T) {
	dir := t.TempDir()
	c := config{Version: 1, Hostname: "node", AllowedNodes: []string{"controller"}}
	if e := writeJSON(filepath.Join(dir, "connection.json"), c); e != nil {
		t.Fatal(e)
	}
	got, e := readConfig(dir)
	if e != nil || !reflect.DeepEqual(got, c) {
		t.Fatal("configuration lost", e)
	}
	info, _ := os.Stat(filepath.Join(dir, "connection.json"))
	if info.Mode().Perm() != 0600 {
		t.Fatal("private config permissions", info.Mode())
	}
	release, e := lock(filepath.Join(dir, "lock"))
	if e != nil {
		t.Fatal(e)
	}
	defer release()
	if unlock, e := lock(filepath.Join(dir, "lock")); e == nil {
		unlock()
		t.Fatal("duplicate node admitted")
	}
}

func TestLocalStatusRequiresPrivateCapabilityAndRejectsOtherOrigins(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s := newLocalStatus(t.TempDir(), cancel)
	if e := s.start(); e != nil {
		t.Fatal(e)
	}
	defer s.close()
	response, e := http.Get(s.state.Address + "/wrong")
	if e != nil {
		t.Fatal(e)
	}
	response.Body.Close()
	if response.StatusCode != 404 {
		t.Fatal("status public")
	}
	req, _ := http.NewRequest("POST", s.state.Address+"/"+s.state.Token+"/stop", nil)
	req.Header.Set("Origin", "https://attacker.test")
	response, e = http.DefaultClient.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	response.Body.Close()
	if response.StatusCode != 403 {
		t.Fatal("cross-origin stop accepted")
	}
	response, e = http.Get(s.state.Address + "/" + s.state.Token)
	if e != nil {
		t.Fatal(e)
	}
	body, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if !strings.Contains(string(body), "uninstall") || !strings.Contains(string(body), "/update") || !strings.Contains(string(body), Version) {
		t.Fatal("missing client status version, update or uninstall")
	}
	req, _ = http.NewRequest("POST", s.state.Address+"/"+s.state.Token+"/update", nil)
	req.Header.Set("Origin", "https://attacker.test")
	response, e = http.DefaultClient.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	response.Body.Close()
	if response.StatusCode != 403 {
		t.Fatal("cross-origin update accepted")
	}
	select {
	case <-ctx.Done():
		t.Fatal("rejected request stopped agent")
	default:
	}
}

func TestMacLauncherCompilesWithoutLaunching(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("macOS compiler only")
	}
	app := filepath.Join(t.TempDir(), "Node.app")
	cmd := exec.Command("osacompile", "-o", app)
	cmd.Stdin = strings.NewReader(macLauncherSource)
	if out, e := cmd.CombinedOutput(); e != nil {
		t.Fatalf("native launcher source invalid: %v %s", e, out)
	}
	if err := configureMacLauncher(app); err != nil {
		t.Fatal(err)
	}
	icon, err := os.ReadFile(filepath.Join(app, "Contents", "Resources", "applet.icns"))
	if err != nil || !bytes.Equal(icon, nodeIconICNS) {
		t.Fatal("launcher lacks branded ICNS", err)
	}
	value, err := exec.Command("/usr/libexec/PlistBuddy", "-c", "Print :CFBundleIconFile", filepath.Join(app, "Contents", "Info.plist")).Output()
	if err != nil || strings.TrimSpace(string(value)) != "applet.icns" {
		t.Fatal("launcher does not reference installed icon", err)
	}
}

func TestExplicitAgentDirectoryRequiresAbsolutePath(t *testing.T) {
	for _, dir := range []string{"", "relative"} {
		if err := runLocal(context.Background(), dir); err == nil {
			t.Fatal("relative state directory accepted")
		}
	}
	for _, args := range [][]string{{"agent", "--state-dir"}, {"agent", "--unknown", t.TempDir()}} {
		if err := Main(args); err == nil {
			t.Fatal("invalid agent arguments accepted")
		}
	}
}
