package nodeapp

import (
	"context"
	"html"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"
)

func (s *localStatus) networkAction(w http.ResponseWriter, r *http.Request) bool {
	base := "/" + s.state.Token
	if r.Method != "POST" || (r.URL.Path != base+"/login" && r.URL.Path != base+"/authorize") {
		return false
	}
	s.mu.Lock()
	owner := s.network
	s.mu.Unlock()
	if owner == nil {
		http.Error(w, "network_unavailable", 503)
		return true
	}
	ctx, stop := context.WithTimeout(r.Context(), 5*time.Second)
	defer stop()
	var err error
	if r.URL.Path == base+"/login" {
		err = owner.login(ctx)
	} else {
		r.Body = http.MaxBytesReader(w, r.Body, 2048)
		if r.ParseForm() != nil || len(r.PostForm) != 2 || len(r.PostForm["nodeId"]) != 1 || len(r.PostForm["allowed"]) != 1 || (r.PostForm.Get("allowed") != "true" && r.PostForm.Get("allowed") != "false") {
			http.Error(w, "invalid_authorization", 400)
			return true
		}
		err = owner.grant(ctx, r.PostForm.Get("nodeId"), r.PostForm.Get("allowed") == "true")
	}
	if err != nil {
		http.Error(w, "网络操作未完成，请返回状态页检查网络和目标成员后重试。", 503)
		return true
	}
	w.Header().Set("Location", base)
	w.WriteHeader(http.StatusSeeOther)
	return true
}

func renderNetwork(view networkView, token string) (string, string) {
	message := "网络状态不可用，正在重试"
	switch view.BackendState {
	case "NeedsLogin":
		message = "等待 Tailscale 登录授权"
	case "NeedsMachineAuth":
		message = "等待 Tailscale 管理员批准此电脑"
	case "Starting":
		message = "正在连接 Tailscale 网络"
	case "Running":
		message = "Tailscale 网络在线；仅已授权的主端可以控制此电脑"
	case "Stopped":
		message = "Tailscale 网络已停止，请重新启动 CodeVori Node"
	}
	var b strings.Builder
	if u, err := url.Parse(view.AuthURL); err == nil && u.Scheme == "https" && u.Hostname() != "" && u.User == nil {
		b.WriteString(`<p><a target="_blank" rel="noreferrer noopener" href="` + html.EscapeString(u.String()) + `">登录 Tailscale</a></p>`)
	} else if view.BackendState == "NeedsLogin" {
		b.WriteString(`<form method="post" action="/` + token + `/login"><button>开始 Tailscale 登录</button></form>`)
	}
	if view.NodeID != "" {
		b.WriteString(`<p>本机：` + html.EscapeString(view.DNSName) + `<br>节点 ID：` + html.EscapeString(view.NodeID) + `<br>网络：` + html.EscapeString(view.Tailnet) + `</p>`)
	}
	b.WriteString(`<h2>允许控制此电脑的主端</h2><p>在下方选择你的主端并允许，然后回到主端的“设备与连接”中连接这台电脑。</p><ul>`)
	peers := slices.Clone(view.Peers)
	// 已离开网络的授权项仍可撤销，避免成员不可见时留下无法管理的授权。
	for _, id := range view.AllowedNodes {
		if !slices.ContainsFunc(peers, func(p networkPeer) bool { return p.ID == id }) {
			peers = append(peers, networkPeer{ID: id, Name: id})
		}
	}
	for _, p := range peers {
		allowed := slices.Contains(view.AllowedNodes, p.ID)
		label, value := "允许控制", "true"
		if allowed {
			label, value = "撤销控制", "false"
		}
		online := "离线"
		if p.Online {
			online = "在线"
		}
		b.WriteString(`<li>` + html.EscapeString(p.Name) + ` · ` + html.EscapeString(p.OS) + ` · ` + online + `<br><small>` + html.EscapeString(p.ID) + `</small><form method="post" action="/` + token + `/authorize"><input type="hidden" name="nodeId" value="` + html.EscapeString(p.ID) + `"><input type="hidden" name="allowed" value="` + value + `"><button>` + label + `</button></form></li>`)
	}
	if len(peers) == 0 {
		b.WriteString(`<li>暂无网络成员。请确认主端与此电脑已登录同一 Tailscale 网络，并获准互相访问。</li>`)
	}
	b.WriteString(`</ul>`)
	return message, b.String()
}
