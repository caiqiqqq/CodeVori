package pairing

import (
	"encoding/json"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

func reply(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if v != nil {
		_ = json.NewEncoder(w).Encode(v)
	}
}
func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	d.DisallowUnknownFields()
	if d.Decode(v) != nil || d.Decode(new(any)) != io.EOF {
		reply(w, 400, map[string]string{"error": "invalid_request"})
		return false
	}
	return true
}
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	// 安装邀请是能力凭据；不支持跨站表单/脚本发起控制命令。
	if r.Header.Get("Origin") != "" {
		reply(w, 403, nil)
		return
	}
	path := strings.Trim(r.URL.Path, "/")
	parts := strings.Split(path, "/")
	if r.Method == "GET" && path == "healthz" {
		reply(w, 200, map[string]bool{"ok": true})
		return
	}
	if r.Method == "POST" && path == "v1/pairs" {
		s.create(w, r)
		return
	}
	if r.Method == "POST" && path == "v1/redeem" {
		s.redeem(w, r)
		return
	}
	if len(parts) == 4 && parts[0] == "v1" && parts[1] == "download" && r.Method == "GET" {
		s.install(w, r, parts[2], parts[3])
		return
	}
	if len(parts) == 4 && parts[0] == "v1" && parts[1] == "install" && r.Method == "GET" {
		s.installPage(w, r, parts[2], parts[3])
		return
	}
	if len(parts) < 3 || len(parts) > 4 || parts[0] != "v1" || parts[1] != "pairs" {
		reply(w, 404, nil)
		return
	}
	id := parts[2]
	bearer := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	s.mu.Lock()
	p := s.records[id]
	controller := p != nil && credential.MatchString(bearer) && digest(bearer) == p.ControllerHash
	node := p != nil && credential.MatchString(bearer) && digest(bearer) == p.NodeHash
	if len(parts) == 4 && parts[3] == "socket" && r.Method == "GET" {
		s.mu.Unlock()
		if !node {
			reply(w, 401, nil)
			return
		}
		s.socket(w, r, id)
		return
	}
	if !controller {
		s.mu.Unlock()
		reply(w, 401, nil)
		return
	}
	if len(parts) == 4 && parts[3] == "mcp" && r.Method == "POST" {
		l := s.links[id]
		disabled := p.Disabled
		s.mu.Unlock()
		if disabled {
			reply(w, 403, nil)
			return
		}
		if l == nil {
			reply(w, 503, map[string]string{"error": "device_offline"})
			return
		}
		s.forward(w, r, l)
		return
	}
	if len(parts) != 3 {
		s.mu.Unlock()
		reply(w, 404, nil)
		return
	}
	if r.Method == "PATCH" {
		var body struct {
			Enabled *bool `json:"enabled"`
		}
		if !readJSON(w, r, &body) || body.Enabled == nil {
			s.mu.Unlock()
			reply(w, 400, nil)
			return
		}
		previous := p.Disabled
		p.Disabled = !*body.Enabled
		if e := s.save(); e != nil {
			p.Disabled = previous
			s.mu.Unlock()
			reply(w, 503, nil)
			return
		}
		if p.Disabled {
			if l := s.links[id]; l != nil {
				l.close()
				delete(s.links, id)
			}
		}
		s.mu.Unlock()
		reply(w, 204, nil)
		return
	}
	if r.Method == "DELETE" {
		delete(s.records, id)
		if e := s.save(); e != nil {
			s.records[id] = p
			s.mu.Unlock()
			reply(w, 503, nil)
			return
		}
		if l := s.links[id]; l != nil {
			l.close()
			delete(s.links, id)
		}
		s.mu.Unlock()
		reply(w, 204, nil)
		return
	}
	if r.Method != "GET" {
		s.mu.Unlock()
		reply(w, 405, nil)
		return
	}
	state := "waiting"
	if p.NodeHash != "" {
		state = "offline"
	}
	if s.links[id] != nil {
		state = "online"
	}
	if p.NodeHash == "" && time.Now().After(p.ExpiresAt) {
		state = "expired"
	}
	data := map[string]any{"id": p.ID, "platform": p.Platform, "name": p.Name, "status": state, "expiresAt": p.ExpiresAt}
	if l := s.links[id]; l != nil {
		data["connectionId"] = l.generation
	}
	s.mu.Unlock()
	reply(w, 200, data)
}
func (s *Server) create(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Platform string `json:"platform"`
		Name     string `json:"name"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	if _, ok := Platforms[body.Platform]; !ok || len(body.Name) > 100 {
		reply(w, 400, nil)
		return
	}
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	if ip == "" {
		ip = r.RemoteAddr
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	var recent []time.Time
	for _, t := range s.creates[ip] {
		if now.Sub(t) < time.Minute {
			recent = append(recent, t)
		}
	}
	if len(recent) >= 10 || len(s.creates) >= 4096 && s.creates[ip] == nil {
		reply(w, 429, nil)
		return
	}
	s.creates[ip] = append(recent, now)
	for addr, times := range s.creates {
		if len(times) > 0 && now.Sub(times[len(times)-1]) > time.Minute {
			delete(s.creates, addr)
		}
	}
	for id, p := range s.records {
		if p.NodeHash == "" && now.After(p.ExpiresAt) {
			delete(s.records, id)
		}
	}
	if len(s.records) >= 1024 {
		reply(w, 503, nil)
		return
	}
	id, control, invite := token(), token(), token()
	p := &record{ID: id, ControllerHash: digest(control), InvitationHash: digest(invite), Name: body.Name, Platform: body.Platform, ExpiresAt: now.Add(15 * time.Minute)}
	s.records[id] = p
	if e := s.save(); e != nil {
		delete(s.records, id)
		reply(w, 503, nil)
		return
	}
	reply(w, 201, map[string]any{"id": id, "controllerToken": control, "invitation": invite, "expiresAt": p.ExpiresAt})
}
func (s *Server) redeem(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Invitation string `json:"invitation"`
		Nonce      string `json:"nonce"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	if !credential.MatchString(body.Invitation) || !credential.MatchString(body.Nonce) {
		reply(w, 400, nil)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, p := range s.records {
		if p.InvitationHash != digest(body.Invitation) {
			continue
		}
		if time.Now().After(p.ExpiresAt) {
			reply(w, 410, nil)
			return
		}
		if p.NonceHash != "" && p.NonceHash != digest(body.Nonce) {
			reply(w, 409, nil)
			return
		}
		key := s.nodeToken(p.ID, body.Nonce)
		oldNonce, oldNode := p.NonceHash, p.NodeHash
		p.NonceHash = digest(body.Nonce)
		p.NodeHash = digest(key)
		if e := s.save(); e != nil {
			p.NonceHash, p.NodeHash = oldNonce, oldNode
			reply(w, 503, nil)
			return
		}
		reply(w, 200, map[string]string{"id": p.ID, "nodeToken": key, "serviceUrl": s.cfg.PublicURL})
		return
	}
	reply(w, 404, nil)
}
