package nodeapp

import (
	"context"
	"errors"
	"path/filepath"
)

// Explicit foreground runs isolate tsnet identity and never alter autostart.
func runLocal(ctx context.Context, dir string) error {
	if !filepath.IsAbs(dir) {
		return errors.New("absolute_local_state_directory_required")
	}
	return run(ctx, dir, false)
}
