package pairing

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// Installers are external files. No go:embed or server build step includes client binaries.
func (s *Server) install(w http.ResponseWriter, r *http.Request, invitation, platform string) {
	ext, ok := Platforms[platform]
	if !ok || !credential.MatchString(invitation) {
		reply(w, 404, nil)
		return
	}
	s.mu.Lock()
	var valid bool
	for _, p := range s.records {
		if p.InvitationHash == digest(invitation) && p.Platform == platform && p.NodeHash == "" && time.Now().Before(p.ExpiresAt) {
			valid = true
			break
		}
	}
	s.mu.Unlock()
	if !valid {
		reply(w, 410, nil)
		return
	}
	f, size, e := s.openAsset(r, platform)
	if e != nil {
		reply(w, 503, map[string]string{"error": "installer_unavailable"})
		return
	}
	defer f.Close()
	if ext == ".exe" {
		w.Header().Set("Content-Type", "application/vnd.microsoft.portable-executable")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="CodeVoriSetup-%s.exe"`, invitation))
		if size >= 0 {
			w.Header().Set("Content-Length", fmt.Sprint(size))
		}
		_, _ = io.Copy(w, io.LimitReader(f, 32<<20))
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="CodeVoriNode-`+platform+`.zip"`)
	z := zip.NewWriter(w)
	defer z.Close()
	add := func(name string, mode os.FileMode, data io.Reader) error {
		h := &zip.FileHeader{Name: name, Method: zip.Deflate}
		h.SetMode(mode)
		entry, err := z.CreateHeader(h)
		if err != nil {
			return err
		}
		_, err = io.Copy(entry, data)
		return err
	}
	cfg, _ := json.Marshal(map[string]string{"serviceUrl": s.cfg.PublicURL, "invitation": invitation})
	if strings.HasPrefix(platform, "darwin-") {
		_ = add("CodeVori Node.app/Contents/MacOS/CodeVoriNode", 0755, f)
		_ = add("CodeVori Node.app/Contents/Resources/invitation.json", 0600, strings.NewReader(string(cfg)))
		plist := `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>CodeVoriNode</string><key>CFBundleIdentifier</key><string>app.codevori.node</string><key>CFBundleName</key><string>CodeVori Node</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/></dict></plist>`
		_ = add("CodeVori Node.app/Contents/Info.plist", 0644, strings.NewReader(plist))
		return
	}
	_ = add("CodeVoriNode", 0755, f)
	_ = add("invitation.json", 0600, strings.NewReader(string(cfg)))
	launcher := "[Desktop Entry]\nType=Application\nName=Install CodeVori Node\nTerminal=false\nExec=sh -c 'cd \"$(dirname \"$1\")\"; exec ./CodeVoriNode' sh %k\n"
	_ = add("Install CodeVori Node.desktop", 0755, strings.NewReader(launcher))
}
