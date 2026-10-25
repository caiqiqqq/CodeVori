package nodeapp

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"html/template"
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
	// no-referrer 会让浏览器表单 POST 携带 Origin: null，被本机来源校验拒绝。
	// same-origin 保留本机表单的真实 Origin，同时禁止向外站泄漏私有能力路径。
	w.Header().Set("Referrer-Policy", "same-origin")
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
	page := statusPageView{Version: Version, Token: s.state.Token, Message: message, Label: "正在启动", Tone: "neutral", CanUninstall: s.canUninstall}
	if network != nil {
		view := network.snapshot()
		presentation := describeNetwork(view.BackendState)
		var networkHTML string
		page.Message, networkHTML = renderNetwork(view, s.state.Token)
		page.Label, page.Tone = presentation.label, presentation.tone
		// 片段只由本包生成，网络成员与登录 URL 已在 renderNetwork 中转义和校验。
		page.Network = template.HTML(networkHTML)
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = renderStatusPage(w, page)
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
