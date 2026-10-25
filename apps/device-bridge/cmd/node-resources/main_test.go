package main

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/tc-hib/winres"
)

func TestPackagedWindowsIconRoundTrip(t *testing.T) {
	for _, arch := range []string{"amd64", "arm64"} {
		t.Run(arch, func(t *testing.T) {
			dir := t.TempDir()
			source := filepath.Join(dir, "main.go")
			if err := os.WriteFile(source, []byte("package main\nfunc main() {}\n"), 0600); err != nil {
				t.Fatal(err)
			}
			executable := filepath.Join(dir, "CodeVoriNode.exe")
			cmd := exec.Command("go", "build", "-trimpath", "-buildvcs=false", "-o", executable, source)
			cmd.Env = append(os.Environ(), "GOOS=windows", "GOARCH="+arch, "CGO_ENABLED=0")
			if out, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("build: %v %s", err, out)
			}
			iconPath := "../../internal/nodeapp/assets/icon.ico"
			if err := embedIcon(executable, iconPath); err != nil {
				t.Fatal(err)
			}
			file, err := os.Open(executable)
			if err != nil {
				t.Fatal(err)
			}
			defer file.Close()
			resources, err := winres.LoadFromEXE(file)
			if err != nil {
				t.Fatal(err)
			}
			icon, err := resources.GetIcon(winres.ID(1))
			if err != nil {
				t.Fatal(err)
			}
			var actual bytes.Buffer
			if err = icon.SaveICO(&actual); err != nil {
				t.Fatal(err)
			}
			original, err := os.Open(iconPath)
			if err != nil {
				t.Fatal(err)
			}
			defer original.Close()
			expected, err := winres.LoadICO(original)
			if err != nil {
				t.Fatal(err)
			}
			var expectedBytes bytes.Buffer
			if err = expected.SaveICO(&expectedBytes); err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(actual.Bytes(), expectedBytes.Bytes()) {
				t.Fatal("packaged executable lost multi-resolution brand icon")
			}
		})
	}
}
