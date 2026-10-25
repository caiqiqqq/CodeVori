package nodeapp

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestStatusPageSeparatesNetworkAndControlAuthorization(t *testing.T) {
	for _, tc := range []struct {
		name, state, label, tone string
	}{
		{"login", "NeedsLogin", "等待登录", "warning"},
		{"approval", "NeedsMachineAuth", "等待管理员批准", "warning"},
		{"starting", "Starting", "正在连接", "neutral"},
		{"online", "Running", "网络已连接", "success"},
		{"stopped", "Stopped", "连接已停止", "neutral"},
		{"unknown", "future-state", "网络状态不可用", "warning"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := newLocalStatus(t.TempDir(), func() {})
			s.state = localState{Address: "http://127.0.0.1:1234", Token: "private"}
			s.canUninstall = false
			s.network = newNetworkController(t.TempDir(), config{}, nil)
			s.network.state = networkState{BackendState: tc.state, NodeID: "self", DNSName: `<script>not-device-code</script>`, Peers: []networkPeer{{ID: "peer", Name: `<img src=x onerror=alert(1)>`, Online: true}}}
			w := httptest.NewRecorder()
			s.ServeHTTP(w, httptest.NewRequest("GET", s.state.Address+"/private", nil))
			body := w.Body.String()
			if w.Code != 200 || !strings.Contains(body, `id="connection-title" class="text-ui-xl">`+tc.label) || !strings.Contains(body, `status-icon tone-`+tc.tone+`"`) {
				t.Fatal("network state presentation does not match owner snapshot")
			}
			if strings.Contains(body, ">已授权</span>") || !strings.Contains(body, ">未授权</span>") {
				t.Fatal("network or peer online status incorrectly grants control")
			}
			if strings.Contains(body, "<script>") || strings.Contains(body, "<img ") || !strings.Contains(body, "&lt;script&gt;") {
				t.Fatal("network values were not escaped in full page")
			}
			if strings.Contains(body, `action="/private/update"`) || strings.Contains(body, `action="/private/uninstall"`) {
				t.Fatal("unsupported installation actions are visible")
			}
		})
	}
}

func TestStatusPageEmptyAndRemovedAuthorizedPeer(t *testing.T) {
	view := networkView{networkState: networkState{BackendState: "Unavailable"}}
	_, empty := renderNetwork(view, "private")
	if !strings.Contains(empty, "暂无可授权的主端") || strings.Contains(empty, "/authorize") {
		t.Fatal("empty network should explain how to find a controller")
	}
	view.AllowedNodes = []string{"removed"}
	_, removed := renderNetwork(view, "private")
	for _, content := range []string{">已授权</span>", ">离线</span>", ">撤销控制</button>", `value="removed"`, `value="false"`} {
		if !strings.Contains(removed, content) {
			t.Fatal("removed controller must remain visibly authorized, offline and revocable", content)
		}
	}
}
