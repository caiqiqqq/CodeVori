package nodeapp

import (
	"bytes"
	"context"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

func TestStandaloneBrandAssets(t *testing.T) {
	for _, asset := range []struct {
		data []byte
		size int
	}{{nodeIconPNG, 256}, {nodeTrayPNG, 32}} {
		image, err := png.Decode(bytes.NewReader(asset.data))
		if err != nil || image.Bounds().Dx() != asset.size || image.Bounds().Dy() != asset.size {
			t.Fatalf("invalid embedded icon: %v", err)
		}
	}
}

func TestLocalTrayCannotUninstallAndStopCancelsOwner(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	local := newTrayActions(t.TempDir(), false, cancel)
	if len(local) != 2 || local[0].id != "open" || local[1].id != "stop" {
		t.Fatal("explicit local runs must only offer status and stop")
	}
	if err := local[1].run(); err != nil || ctx.Err() == nil {
		t.Fatal("stop must cancel the existing runtime owner", err)
	}
	installed := newTrayActions(t.TempDir(), true, cancel)
	if len(installed) != 3 || installed[2].id != "uninstall" {
		t.Fatal("installed tray lost its uninstall entry")
	}
}

func TestRefreshAppearanceDoesNotChangePrivateConfiguration(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "connection.json")
	private := []byte(`{"version":1,"hostname":"test-node","allowedNodes":["controller"]}`)
	if err := os.WriteFile(file, private, 0600); err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(dir, "CodeVori Node.app", "Contents", "MacOS", "CodeVoriNode")
	if err := refreshNodeAppearance(binary); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(file)
	if err != nil || !bytes.Equal(got, private) {
		t.Fatal("appearance changed network configuration", err)
	}
}
