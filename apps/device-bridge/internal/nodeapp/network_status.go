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

type networkPresentation struct{ label, tone, message string }

func describeNetwork(state string) networkPresentation {
	switch state {
	case "NeedsLogin":
		return networkPresentation{"等待登录", "warning", "请登录 Tailscale，加入主端所在的网络。"}
	case "NeedsMachineAuth":
		return networkPresentation{"等待管理员批准", "warning", "请联系 Tailscale 管理员，批准此电脑加入网络。"}
	case "Starting":
		return networkPresentation{"正在连接", "neutral", "正在连接 Tailscale 网络，请稍候。"}
	case "Running":
		return networkPresentation{"网络已连接", "success", "Tailscale 网络在线，主端可通过授权连接此电脑。"}
	case "Stopped":
		return networkPresentation{"连接已停止", "neutral", "请重新启动 CodeVori Node，以连接 Tailscale 网络。"}
	}
	return networkPresentation{"网络状态不可用", "warning", "暂时无法获取 Tailscale 网络状态，正在重试。"}
}

const computerIcon = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21h8m-4-5v5"/></svg>`
const shieldIcon = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/></svg>`

func renderNetwork(view networkView, token string) (string, string) {
	presentation := describeNetwork(view.BackendState)
	var b strings.Builder
	if u, err := url.Parse(view.AuthURL); err == nil && u.Scheme == "https" && u.Hostname() != "" && u.User == nil {
		b.WriteString(`<div class="login-action"><a class="button button-primary" target="_blank" rel="noreferrer noopener" href="` + html.EscapeString(u.String()) + `">登录 Tailscale <span aria-hidden="true">↗</span></a></div>`)
	} else if view.BackendState == "NeedsLogin" {
		b.WriteString(`<form class="login-action" method="post" action="/` + token + `/login"><button class="button-primary" type="submit">开始 Tailscale 登录</button></form>`)
	}
	if view.NodeID != "" {
		b.WriteString(`<dl class="identity"><div><dt class="text-ui-caption">本机地址</dt><dd class="mono text-ui-caption">` + html.EscapeString(view.DNSName) + `</dd></div><div><dt class="text-ui-caption">所属网络</dt><dd class="text-ui-caption">` + html.EscapeString(view.Tailnet) + `</dd></div><div class="wide"><dt class="text-ui-caption">节点 ID</dt><dd class="mono text-ui-caption">` + html.EscapeString(view.NodeID) + `</dd></div></dl>`)
	}
	peers := slices.Clone(view.Peers)
	// 已离开网络的授权项仍可撤销，避免成员不可见时留下无法管理的授权。
	for _, id := range view.AllowedNodes {
		if !slices.ContainsFunc(peers, func(p networkPeer) bool { return p.ID == id }) {
			peers = append(peers, networkPeer{ID: id, Name: id})
		}
	}
	b.WriteString(`<section class="authorization" aria-labelledby="controllers-title"><div class="section-heading"><h2 id="controllers-title" class="section-title text-ui-lg">` + shieldIcon + `主端授权</h2></div><p class="section-description text-ui-caption">允许你的主端控制此电脑，再前往主端的“设备与连接”中连接。执行命令和桌面操作时，请保持此电脑的用户登录。</p><ul class="peers" aria-label="允许控制此电脑的主端">`)
	for _, p := range peers {
		allowed := slices.Contains(view.AllowedNodes, p.ID)
		label, value, buttonClass, authorization := "允许控制", "true", "button-primary", `<span class="muted text-ui-sm">未授权</span>`
		if allowed {
			label, value, buttonClass, authorization = "撤销控制", "false", "", `<span class="badge badge-authorized text-ui-sm">`+shieldIcon+`已授权</span>`
		}
		online, tone := "离线", "tone-neutral"
		if p.Online {
			online, tone = "在线", "tone-success"
		}
		osName := p.OS
		if osName == "" {
			osName = "系统未知"
		}
		b.WriteString(`<li class="peer"><div class="peer-main"><span class="device-icon">` + computerIcon + `</span><div class="peer-info"><div class="peer-name">` + html.EscapeString(p.Name) + `</div><div class="peer-meta text-ui-sm"><span class="muted">` + html.EscapeString(osName) + `</span><span class="badge ` + tone + `"><span class="dot" aria-hidden="true"></span>` + online + `</span></div><p class="peer-id mono text-ui-sm">` + html.EscapeString(p.ID) + `</p></div></div><div class="peer-actions">` + authorization + `<form method="post" action="/` + token + `/authorize"><input type="hidden" name="nodeId" value="` + html.EscapeString(p.ID) + `"><input type="hidden" name="allowed" value="` + value + `"><button class="` + buttonClass + `" type="submit">` + label + `</button></form></div></li>`)
	}
	if len(peers) == 0 {
		b.WriteString(`<li class="empty-state">` + computerIcon + `<div><strong>暂无可授权的主端</strong><p class="text-ui-caption">请确认主端与此电脑已登录同一 Tailscale 网络，并获准互相访问。</p></div></li>`)
	}
	b.WriteString(`</ul></section>`)
	return presentation.message, b.String()
}
