package pairing

import (
	"html"
	"io"
	"net/http"
	"net/url"
	"time"
)

func (s *Server) installPage(w http.ResponseWriter, r *http.Request, invitation, platform string) {
	if !credential.MatchString(invitation) {
		reply(w, 404, nil)
		return
	}
	if _, ok := Platforms[platform]; !ok {
		reply(w, 404, nil)
		return
	}
	s.mu.Lock()
	valid := false
	for _, p := range s.records {
		if p.InvitationHash == digest(invitation) && p.Platform == platform && p.NodeHash == "" && time.Now().Before(p.ExpiresAt) {
			valid = true
			break
		}
	}
	s.mu.Unlock()
	if !valid {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(410)
		_, _ = io.WriteString(w, `<!doctype html><meta charset="utf-8"><title>CodeVori Node</title><p>安装链接已过期或已使用，请回到主端重新添加电脑。</p>`)
		return
	}
	app := "codevori-node://enroll?" + url.Values{"service": {s.cfg.PublicURL}, "invitation": {invitation}}.Encode()
	download := s.cfg.PublicURL + "/v1/download/" + invitation + "/" + platform
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'")
	_, _ = io.WriteString(w, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>安装 CodeVori Node</title><style>body{font:16px system-ui;margin:3rem auto;max-width:34rem;padding:1rem;color:#222;background:#fafafa}a{display:block;border:1px solid #888;border-radius:8px;padding:1rem;margin:1rem 0;color:inherit;text-decoration:none}p{line-height:1.7}</style><h1>CodeVori Node</h1><p>安装轻量执行端后，此电脑将自动连接主端，用于执行命令和桌面操作。请保持用户登录。</p><a href="`+html.EscapeString(download)+`">下载并安装 · `+html.EscapeString(platform)+`</a><a href="`+html.EscapeString(app)+`">已经安装？打开应用并配对</a><p>此链接 15 分钟内有效。安装时会请你确认允许配对主端控制此电脑。</p></html>`)
}
