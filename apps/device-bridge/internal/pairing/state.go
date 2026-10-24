// Package pairing owns enrollment metadata and transient transport only, never tasks or results.
package pairing

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

type Config struct{ StateDir, PublicURL, AssetsDir, AssetsURL string }
type record struct {
	ID             string    `json:"id"`
	ControllerHash string    `json:"controllerHash"`
	InvitationHash string    `json:"invitationHash"`
	NodeHash       string    `json:"nodeHash,omitempty"`
	NonceHash      string    `json:"nonceHash,omitempty"`
	Platform       string    `json:"platform"`
	Name           string    `json:"name"`
	Disabled       bool      `json:"disabled,omitempty"`
	ExpiresAt      time.Time `json:"expiresAt"`
}
type diskState struct {
	Key     string             `json:"key"`
	Records map[string]*record `json:"records"`
}
type Server struct {
	mu      sync.Mutex
	cfg     Config
	key     []byte
	records map[string]*record
	links   map[string]*link
	creates map[string][]time.Time
}

var credential = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
var Platforms = map[string]string{"win32-x64": ".exe", "win32-arm64": ".exe", "darwin-x64": ".zip", "darwin-arm64": ".zip", "linux-x64": ".zip", "linux-arm64": ".zip"}

func ValidateURL(raw string) error {
	u, e := url.Parse(raw)
	if e != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Opaque != "" {
		return errors.New("invalid_service_url")
	}
	if u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "127.0.0.1" || u.Hostname() == "::1" || u.Hostname() == "localhost")) {
		return errors.New("https_required")
	}
	return nil
}
func token() string {
	b := make([]byte, 32)
	if _, e := rand.Read(b); e != nil {
		panic("random source unavailable")
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
func digest(v string) string { b := sha256.Sum256([]byte(v)); return hex.EncodeToString(b[:]) }
func (s *Server) nodeToken(id, nonce string) string {
	h := hmac.New(sha256.New, s.key)
	h.Write([]byte(id + ":" + nonce))
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}
func New(cfg Config) (*Server, error) {
	if e := ValidateURL(cfg.PublicURL); e != nil {
		return nil, e
	}
	cfg.PublicURL = strings.TrimRight(cfg.PublicURL, "/")
	if cfg.AssetsURL != "" {
		if e := ValidateURL(cfg.AssetsURL); e != nil {
			return nil, e
		}
	}
	if !filepath.IsAbs(cfg.StateDir) || cfg.AssetsURL == "" && !filepath.IsAbs(cfg.AssetsDir) {
		return nil, errors.New("absolute_directories_required")
	}
	if e := os.MkdirAll(cfg.StateDir, 0700); e != nil {
		return nil, e
	}
	s := &Server{cfg: cfg, records: map[string]*record{}, links: map[string]*link{}, creates: map[string][]time.Time{}}
	b, e := os.ReadFile(filepath.Join(cfg.StateDir, "pairings.json"))
	if e == nil {
		var d diskState
		if json.Unmarshal(b, &d) != nil {
			return nil, errors.New("invalid_pairing_state")
		}
		s.key, e = base64.RawURLEncoding.DecodeString(d.Key)
		if e != nil || len(s.key) != 32 || d.Records == nil {
			return nil, errors.New("invalid_pairing_state")
		}
		s.records = d.Records
	} else if os.IsNotExist(e) {
		s.key = make([]byte, 32)
		if _, e = rand.Read(s.key); e != nil {
			return nil, e
		}
		if e = s.save(); e != nil {
			return nil, e
		}
	} else {
		return nil, e
	}
	return s, nil
}
func (s *Server) save() error {
	b, e := json.Marshal(diskState{base64.RawURLEncoding.EncodeToString(s.key), s.records})
	if e != nil {
		return e
	}
	file := filepath.Join(s.cfg.StateDir, "pairings.json")
	if e = os.WriteFile(file+".tmp", b, 0600); e != nil {
		return e
	}
	return os.Rename(file+".tmp", file)
}
func (s *Server) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, l := range s.links {
		l.close()
		delete(s.links, id)
	}
}
