package nodeapp

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"html"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

// A system-browser fallback keeps Linux installation usable without a bundled GUI toolkit.
func browserConfirm(title, text string) bool {
	l, e := net.Listen("tcp4", "127.0.0.1:0")
	if e != nil {
		return false
	}
	defer l.Close()
	b := make([]byte, 32)
	if _, e = rand.Read(b); e != nil {
		return false
	}
	token := base64.RawURLEncoding.EncodeToString(b)
	origin := "http://" + l.Addr().String()
	result := make(chan bool, 1)
	server := &http.Server{ReadHeaderTimeout: 5 * time.Second, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; form-action 'self'; frame-ancestors 'none'")
		if r.Host != strings.TrimPrefix(origin, "http://") || r.URL.Path != "/"+token {
			http.NotFound(w, r)
			return
		}
		if r.Method == "POST" {
			if r.Header.Get("Origin") != origin {
				http.Error(w, "forbidden", 403)
				return
			}
			r.Body = http.MaxBytesReader(w, r.Body, 128)
			_ = r.ParseForm()
			select {
			case result <- r.Form.Get("accept") == "yes":
			default:
			}
			_, _ = io.WriteString(w, "已确认，可以关闭本页。")
			return
		}
		if r.Method != "GET" {
			w.WriteHeader(405)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = io.WriteString(w, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>`+html.EscapeString(title)+`</title><h1>`+html.EscapeString(title)+`</h1><p>`+html.EscapeString(text)+`</p><form method="post"><button name="accept" value="yes">安装 / 确认</button><button name="accept" value="no">取消</button></form>`)
	})}
	go func() { _ = server.Serve(l) }()
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	}()
	if openURL(origin+"/"+token) != nil {
		return false
	}
	select {
	case answer := <-result:
		return answer
	case <-time.After(10 * time.Minute):
		return false
	}
}
