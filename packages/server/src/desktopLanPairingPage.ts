const STORAGE_KEY = "zcode.desktopLan.pairing.v1";

function scriptValue(value: string): string {
  // 固定 Token 可能来自外部配置，不能让 script 结束标签逃出序列化字符串。
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

/** 仅在网关鉴权后传入 Token；浏览器凭据按完整 origin 隔离，不设置时间有效期。 */
export function desktopLanPairingPage(token?: string): string {
  const script = token
    ? `try { localStorage.setItem(key, ${scriptValue(token)}); } catch {}
       location.replace("/");`
    : `const form = document.querySelector("form");
       const button = form.querySelector("button");
       const status = document.querySelector('[role="status"]');
       let pending = false;
       const connect = async (token) => {
         if (pending) return;
         pending = true;
         button.disabled = true;
         try {
           const response = await fetch("/pair", {
             method: "POST", credentials: "same-origin",
             body: new URLSearchParams({ token })
           });
           if (response.status === 401 && !response.redirected) {
             try {
               if (localStorage.getItem(key) === token) localStorage.removeItem(key);
             } catch {}
             status.textContent = "Invalid access token";
           } else if (response.ok) {
             // Cookie 被浏览器禁用时不能反复跳回入口；确认会话可用后才恢复页面。
             const authorized = await fetch("/api/desktop-window", {
               credentials: "same-origin", cache: "no-store"
             });
             if (authorized.ok) {
               try { localStorage.setItem(key, token); } catch {}
               location.replace("/");
             } else {
               status.textContent = "Unable to authorize this browser.";
             }
           } else {
             status.textContent = "Unable to authorize this browser.";
           }
         } catch {
           status.textContent = "Unable to connect. Please try again.";
         } finally {
           pending = false;
           button.disabled = false;
         }
       };
       // no-referrer 下原生表单可能提交 Origin: null；fetch 保留同源校验所需的 Origin。
       form.addEventListener("submit", (event) => {
         event.preventDefault();
         void connect(new FormData(form).get("token"));
       });
       let saved;
       try { saved = localStorage.getItem(key); } catch {}
       if (saved) await connect(saved);`;
  return `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>ZCode LAN</title>${
    token
      ? "<p>Connecting…</p>"
      : '<form method="post" action="/pair"><label>Access token <input name="token" type="password" required autocomplete="off"></label><button>Connect</button></form><p role="status"></p>'
  }<script>(async () => { const key = ${scriptValue(STORAGE_KEY)}; ${script} })();</script>`;
}
