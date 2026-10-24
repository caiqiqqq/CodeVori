package nodeapp

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestUpdateManifestPinsPlatformOriginVersionAndSize(t *testing.T) {
	data := []byte("a real executable payload")
	sum := sha256.Sum256(data)
	var base string
	var mutate func(*updateManifest)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			t.Error("device credential leaked to asset host")
		}
		if r.URL.Path == "/clients/latest.json" {
			m := updateManifest{Version: "0.0.7", ServiceURL: "https://service.test/nodes", Files: []updateFile{{Platform: "linux-x64", Name: "CodeVoriNode-linux-x64", Bytes: int64(len(data)), SHA256: hex.EncodeToString(sum[:]), URL: base + "/clients/0.0.7/CodeVoriNode-linux-x64"}}}
			if mutate != nil {
				mutate(&m)
			}
			_ = json.NewEncoder(w).Encode(m)
			return
		}
		_, _ = w.Write(data)
	}))
	defer server.Close()
	base = server.URL
	ctx := context.Background()
	m, f, err := checkUpdate(ctx, base+"/clients/latest.json", "https://service.test/nodes", "linux-x64", "0.0.6")
	if err != nil || m.Version != "0.0.7" {
		t.Fatal("valid release rejected", err)
	}
	path, err := downloadUpdate(ctx, t.TempDir(), f)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(path)
	if string(got) != string(data) {
		t.Fatal("download changed")
	}
	for name, change := range map[string]func(*updateManifest){
		"different service": func(m *updateManifest) { m.ServiceURL = "https://other.test" },
		"cross origin":      func(m *updateManifest) { m.Files[0].URL = "https://attacker.test/file" },
		"wrong platform":    func(m *updateManifest) { m.Files[0].Platform = "win32-x64" },
		"wrong filename":    func(m *updateManifest) { m.Files[0].Name = "anything" },
		"traversal":         func(m *updateManifest) { m.Files[0].URL = base + "/clients/0.0.7/../CodeVoriNode-linux-x64" },
		"missing hash":      func(m *updateManifest) { m.Files[0].SHA256 = "bad" },
		"oversize":          func(m *updateManifest) { m.Files[0].Bytes = 33 << 20 },
		"bad version":       func(m *updateManifest) { m.Version = "../evil" },
	} {
		t.Run(name, func(t *testing.T) {
			mutate = change
			if _, _, err := checkUpdate(ctx, base+"/clients/latest.json", "https://service.test/nodes", "linux-x64", "0.0.6"); err == nil {
				t.Fatal("untrusted release accepted")
			}
		})
	}
	mutate = nil
	for _, current := range []string{"0.0.7", "0.0.8", "1.0.0"} {
		if _, _, err := checkUpdate(ctx, base+"/clients/latest.json", "https://service.test/nodes", "linux-x64", current); !errors.Is(err, errNoUpdate) {
			t.Fatal("downgrade or repeated update admitted", current, err)
		}
	}
	f.SHA256 = strings.Repeat("0", 64)
	dir := t.TempDir()
	if _, err := downloadUpdate(ctx, dir, f); err == nil {
		t.Fatal("checksum mismatch accepted")
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 0 {
		t.Fatal("invalid staged executable retained")
	}
	f.SHA256 = hex.EncodeToString(sum[:])
	f.Bytes++
	if _, err := downloadUpdate(ctx, dir, f); err == nil {
		t.Fatal("size mismatch accepted")
	}
}

func TestExecutableUpdateStartsActualNewProcess(t *testing.T) {
	dir := t.TempDir()
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(dir, "node.exe")
	marker := filepath.Join(dir, "started")
	if err = os.WriteFile(binary, []byte("old"), 0755); err != nil {
		t.Fatal(err)
	}
	err = replaceNodeExecutable(self, binary, func() error {
		cmd := exec.Command(binary, "-test.run=TestUpdateChildProcess", "--", marker)
		cmd.Env = append(os.Environ(), "CODEVORI_NODE_UPDATE_TEST_CHILD=1")
		return cmd.Run()
	})
	if err != nil {
		t.Fatal("replacement did not start", err)
	}
	bytes, err := os.ReadFile(marker)
	if err != nil || string(bytes) != "started" {
		t.Fatal("new process did not execute", err)
	}
}

func TestUpdateChildProcess(t *testing.T) {
	if os.Getenv("CODEVORI_NODE_UPDATE_TEST_CHILD") != "1" {
		return
	}
	if err := os.WriteFile(os.Args[len(os.Args)-1], []byte("started"), 0600); err != nil {
		os.Exit(1)
	}
	os.Exit(0)
}

func TestUpdateRejectsRedirectsAndOversizeManifests(t *testing.T) {
	for _, handler := range []http.HandlerFunc{
		func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, "/elsewhere", 302) },
		func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(strings.Repeat(" ", 33000))) },
	} {
		s := httptest.NewServer(handler)
		_, _, err := checkUpdate(context.Background(), s.URL+"/clients/latest.json", ServiceURL, "linux-x64", "0.0.6")
		s.Close()
		if err == nil {
			t.Fatal("invalid manifest accepted")
		}
	}
}

func TestExecutableUpdatePreservesIdentityAndRollsBackFailedStart(t *testing.T) {
	for _, fail := range []bool{false, true} {
		dir := t.TempDir()
		binary, source := filepath.Join(dir, "node"), filepath.Join(dir, "staged")
		_ = os.WriteFile(binary, []byte("old"), 0755)
		_ = os.WriteFile(source, []byte("new"), 0755)
		c := config{ServiceURL: ServiceURL, ID: strings.Repeat("a", 43), Token: strings.Repeat("b", 43)}
		_ = writeJSON(filepath.Join(dir, "connection.json"), c)
		starts := 0
		err := replaceNodeExecutable(source, binary, func() error {
			starts++
			if fail && starts == 1 {
				return errors.New("cannot_start")
			}
			return nil
		})
		if (err != nil) != fail {
			t.Fatal("wrong replacement result", err)
		}
		bytes, _ := os.ReadFile(binary)
		want := "new"
		if fail {
			want = "old"
			if starts != 2 {
				t.Fatal("old client not restarted")
			}
		}
		if string(bytes) != want {
			t.Fatal("replacement or rollback lost executable")
		}
		got, err := readConfig(dir)
		if err != nil || got != c {
			t.Fatal("update replaced pairing identity", err)
		}
	}
}
