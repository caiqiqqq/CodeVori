package nodeapp

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLinuxInstallationDesktopIconWithSpaces(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, "config"))
	binary := filepath.Join(home, "installed node", "CodeVoriNode")
	if err := autostart(binary, true); err != nil {
		t.Fatal(err)
	}
	icon := filepath.Join(filepath.Dir(binary), "icon.png")
	data, err := os.ReadFile(icon)
	if err != nil || !bytes.Equal(data, nodeIconPNG) {
		t.Fatal("missing installed icon", err)
	}
	for _, entry := range []string{filepath.Join(home, ".local/share/applications/codevori-node.desktop"), filepath.Join(home, "config/autostart/codevori-node.desktop")} {
		data, err = os.ReadFile(entry)
		if err != nil || !strings.Contains(string(data), "\nIcon="+icon+"\n") {
			t.Fatal("desktop entry lacks installed icon", err)
		}
	}
}

func TestLinuxUpdateRefreshesLegacyEntryWithoutEnablingAutostart(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, "config"))
	binary := filepath.Join(home, "installed node", "CodeVoriNode")
	entry := filepath.Join(home, ".local/share/applications/codevori-node.desktop")
	if err := os.MkdirAll(filepath.Dir(entry), 0700); err != nil {
		t.Fatal(err)
	}
	old := "[Desktop Entry]\nType=Application\nName=CodeVori Node\nExec=existing-command\n"
	if err := os.WriteFile(entry, []byte(old), 0600); err != nil {
		t.Fatal(err)
	}
	if err := refreshInstalledNodeAppearance(binary); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(entry)
	if err != nil || !strings.Contains(string(data), "Exec=existing-command\n") || !strings.Contains(string(data), "\nIcon="+filepath.Join(filepath.Dir(binary), "icon.png")+"\n") {
		t.Fatal("legacy entry not migrated", err)
	}
	if _, err := os.Stat(filepath.Join(home, "config/autostart/codevori-node.desktop")); !os.IsNotExist(err) {
		t.Fatal("appearance migration enabled autostart", err)
	}
}
