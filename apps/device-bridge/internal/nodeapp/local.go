package nodeapp

import (
	"context"
	"errors"
	"net/url"
	"path/filepath"
)

// runLocal isolates foreground integration runs without changing the user's OS identity or autostart.
func runLocal(ctx context.Context, dir string) error {
	if !filepath.IsAbs(dir) {
		return errors.New("absolute_local_state_directory_required")
	}
	c, err := readConfig(dir)
	if err != nil {
		return err
	}
	u, err := url.Parse(c.ServiceURL)
	if err != nil || u.Scheme != "http" || (u.Hostname() != "127.0.0.1" && u.Hostname() != "localhost" && u.Hostname() != "::1") {
		return errors.New("explicit_state_directory_requires_loopback_service")
	}
	return run(ctx, dir, false)
}
