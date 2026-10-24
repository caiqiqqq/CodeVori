package pairing

import (
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Assets can live on a different file server. The service never caches or packages them.
func (s *Server) openAsset(r *http.Request, platform string) (io.ReadCloser, int64, error) {
	name := "CodeVoriNode-" + platform
	if strings.HasPrefix(platform, "win32-") {
		name += ".exe"
	}
	if s.cfg.AssetsURL != "" {
		ctx := r.Context()
		request, e := http.NewRequestWithContext(ctx, "GET", strings.TrimRight(s.cfg.AssetsURL, "/")+"/"+name, nil)
		if e != nil {
			return nil, 0, e
		}
		client := &http.Client{Timeout: 2 * time.Minute, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
		response, e := client.Do(request)
		if e != nil {
			return nil, 0, e
		}
		if response.StatusCode != 200 || response.ContentLength > 32<<20 {
			response.Body.Close()
			return nil, 0, errors.New("installer_unavailable")
		}
		return response.Body, response.ContentLength, nil
	}
	f, e := os.Open(filepath.Join(s.cfg.AssetsDir, name))
	if e != nil {
		return nil, 0, e
	}
	stat, e := f.Stat()
	if e != nil || !stat.Mode().IsRegular() || stat.Size() > 32<<20 {
		f.Close()
		return nil, 0, errors.New("installer_unavailable")
	}
	return f, stat.Size(), nil
}
