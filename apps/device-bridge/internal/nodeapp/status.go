package nodeapp

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"html"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type localState struct {
	Address string `json:"address"`
	Token   string `json:"token"`
}
type localStatus struct {
	canUninstall bool
	mu           sync.Mutex
	message      string
	network      *networkController
	dir          string
	cancel       context.CancelFunc
	state        localState
	server       *http.Server
}

func newLocalStatus(dir string, cancel context.CancelFunc) *localStatus {
	return &localStatus{dir: dir, cancel: cancel, message: "正在启动", canUninstall: true}
}
func (s *localStatus) set(message string) { s.mu.Lock(); s.message = message; s.mu.Unlock() }
func (s *localStatus) start() error {
	l, e := net.Listen("tcp4", "127.0.0.1:0")
	if e != nil {
		return e
	}
	b := make([]byte, 32)
	if _, e = rand.Read(b); e != nil {
		l.Close()
		return e
	}
	s.state = localState{Address: "http://" + l.Addr().String(), Token: base64.RawURLEncoding.EncodeToString(b)}
	s.server = &http.Server{Handler: s, ReadHeaderTimeout: 5 * time.Second}
	if e = writeJSON(filepath.Join(s.dir, "runtime.json"), s.state); e != nil {
		l.Close()
		return e
	}
	go func() { _ = s.server.Serve(l) }()
	return nil
}
func (s *localStatus) close() {
	ctx, stop := context.WithTimeout(context.Background(), time.Second)
	defer stop()
	_ = s.server.Shutdown(ctx)
	_ = os.Remove(filepath.Join(s.dir, "runtime.json"))
}
func (s *localStatus) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'")
	if r.Host != strings.TrimPrefix(s.state.Address, "http://") {
		http.Error(w, "forbidden", 403)
		return
	}
	if r.Method == "POST" && r.Header.Get("Origin") != "" && r.Header.Get("Origin") != s.state.Address {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	if s.networkAction(w, r) {
		return
	}
	if r.URL.Path == "/"+s.state.Token+"/update" && r.Method == "POST" {
		if !s.canUninstall {
			http.NotFound(w, r)
			return
		}
		_, binary, err := paths()
		if err == nil {
			err = startDetached(binary, "update")
		}
		if err != nil {
			http.Error(w, "update_unavailable", 503)
			return
		}
		w.Header().Set("Location", "/"+s.state.Token)
		w.WriteHeader(http.StatusSeeOther)
		return
	}
	if r.URL.Path == "/"+s.state.Token+"/uninstall" && r.Method == "POST" {
		if !s.canUninstall {
			http.NotFound(w, r)
			return
		}
		_, binary, err := paths()
		if err == nil {
			err = startDetached(binary, "uninstall")
		}
		if err != nil {
			http.Error(w, "uninstall_unavailable", 503)
			return
		}
		w.WriteHeader(202)
		return
	}
	if r.URL.Path == "/"+s.state.Token+"/stop" && r.Method == "POST" {
		w.WriteHeader(202)
		_, _ = io.WriteString(w, "连接已停止。关闭本页即可。再次打开 CodeVori Node 可重新连接。")
		s.cancel()
		return
	}
	if r.Method != "GET" || r.URL.Path != "/"+s.state.Token {
		http.NotFound(w, r)
		return
	}
	s.mu.Lock()
	message := s.message
	network := s.network
	s.mu.Unlock()
	networkHTML := ""
	if network != nil {
		message, networkHTML = renderNetwork(network.snapshot(), s.state.Token)
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	uninstall := ""
	if s.canUninstall {
		uninstall = `<form method="post" action="/` + s.state.Token + `/update"><button>检查更新</button></form><p>更新会保留 Tailscale 身份和控制授权。</p><form method="post" action="/` + s.state.Token + `/uninstall"><button>卸载</button></form><p>卸载会移除此电脑上的连接配置。</p>`
	}
	_, _ = io.WriteString(w, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="refresh" content="5"><title>CodeVori Node</title><style>body{font:16px system-ui;max-width:36rem;padding:2rem;margin:auto;background:#f7f7f8;color:#222;overflow-wrap:anywhere}button{font:inherit;padding:.6rem 1rem}p{line-height:1.6}li{margin:1rem 0}form{margin:.5rem 0}</style><h1>CodeVori Node</h1><p>版本 `+html.EscapeString(Version)+`</p><p>`+html.EscapeString(message)+`</p><p>请加入主端所在的 Tailscale 网络，再允许对应主端控制此电脑。执行命令和桌面操作需要保持用户登录。</p>`+networkHTML+`<form method="post" action="/`+s.state.Token+`/stop"><button>停止连接</button></form>`+uninstall+`</html>`)
}
func local(dir string) (localState, error) {
	var s localState
	b, e := os.ReadFile(filepath.Join(dir, "runtime.json"))
	if e != nil {
		return s, e
	}
	if json.Unmarshal(b, &s) != nil || !secretPattern.MatchString(s.Token) {
		return s, errors.New("invalid_local_state")
	}
	host, port, e := net.SplitHostPort(strings.TrimPrefix(s.Address, "http://"))
	if e != nil || host != "127.0.0.1" || port == "" {
		return s, errors.New("invalid_local_address")
	}
	return s, nil
}
func openStatus(dir string) error {
	s, e := local(dir)
	if e != nil {
		return e
	}
	client := &http.Client{Timeout: time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	r, e := client.Get(s.Address + "/" + s.Token)
	if e != nil {
		return e
	}
	r.Body.Close()
	if r.StatusCode != 200 {
		return errors.New("node_offline")
	}
	return openURL(s.Address + "/" + s.Token)
}
func stopLocal(dir string) error {
	s, e := local(dir)
	if e != nil {
		return e
	}
	client := &http.Client{Timeout: 2 * time.Second}
	r, e := client.Post(s.Address+"/"+s.Token+"/stop", "application/json", nil)
	if e == nil {
		r.Body.Close()
	}
	return e
}
