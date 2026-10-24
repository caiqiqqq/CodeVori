package nodeapp

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestInstallationIdentityAndPrivateConfig(t *testing.T) {
	dir := t.TempDir()
	c := config{ServiceURL: "https://example.test/device-node", ID: strings.Repeat("a", 43), Token: strings.Repeat("b", 43)}
	if e := writeJSON(filepath.Join(dir, "connection.json"), c); e != nil {
		t.Fatal(e)
	}
	got, e := readConfig(dir)
	if e != nil || got != c {
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
	key := strings.Repeat("c", 43)
	for _, name := range []string{"CodeVoriSetup-" + key + ".exe", "CodeVoriSetup-" + key + " (1).exe"} {
		i, e := loadInvitation(filepath.Join(dir, name))
		if e != nil || i.Invitation != key {
			t.Fatal("download filename lost invitation", name, e)
		}
	}
	if _, e := loadInvitation(filepath.Join(dir, "CodeVoriSetup-bad.exe")); e == nil {
		t.Fatal("unbound installer accepted")
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
	if !strings.Contains(string(body), "uninstall") {
		t.Fatal("missing GUI uninstall")
	}
	select {
	case <-ctx.Done():
		t.Fatal("rejected request stopped agent")
	default:
	}
}

func TestApplicationLinkIsBoundToConfiguredService(t *testing.T) {
	key := strings.Repeat("a", 43)
	good := "codevori-node://enroll?service=" + url.QueryEscape(ServiceURL) + "&invitation=" + key
	if i, e := parseAppLink(good); e != nil || i.Invitation != key {
		t.Fatal(e)
	}
	for _, bad := range []string{strings.Replace(good, "codevori-node:", "https:", 1), strings.Replace(good, url.QueryEscape(ServiceURL), url.QueryEscape("https://attacker.test"), 1), good + "&invitation=" + key} {
		if _, e := parseAppLink(bad); e == nil {
			t.Fatal("untrusted app link accepted")
		}
	}
}

func TestMacLauncherCompilesWithoutLaunching(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("macOS compiler only")
	}
	cmd := exec.Command("osacompile", "-o", filepath.Join(t.TempDir(), "Node.app"))
	cmd.Stdin = strings.NewReader(macLauncherSource)
	if out, e := cmd.CombinedOutput(); e != nil {
		t.Fatalf("native launcher source invalid: %v %s", e, out)
	}
}

func TestExplicitAgentDirectoryIsLocalOnly(t *testing.T) {
	for _, dir := range []string{"", "relative"} {
		if err := runLocal(context.Background(), dir); err == nil {
			t.Fatal("relative state directory accepted")
		}
	}
	dir := t.TempDir()
	c := config{ServiceURL: "https://example.test/device-node", ID: strings.Repeat("a", 43), Token: strings.Repeat("b", 43)}
	if err := writeJSON(filepath.Join(dir, "connection.json"), c); err != nil {
		t.Fatal(err)
	}
	if err := runLocal(context.Background(), dir); err == nil {
		t.Fatal("remote explicit-directory agent accepted")
	}
	for _, args := range [][]string{{"agent", "--state-dir"}, {"agent", "--unknown", dir}} {
		if err := Main(args); err == nil {
			t.Fatal("invalid agent arguments accepted")
		}
	}
}
