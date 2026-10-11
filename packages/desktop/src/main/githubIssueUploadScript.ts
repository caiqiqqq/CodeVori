import type { ForgeWebUploadContext } from "@zcode/shared";

/** 只在已验证仓库的新议题页面调用；借用网页附件控件，不提交网页表单。 */
export function githubIssueUploadScript(
  context: ForgeWebUploadContext,
  timeoutMs = 120_000,
): string {
  return `(() => {
    const context = ${JSON.stringify(context)};
    return new Promise((resolve, reject) => {
      let finished = false, attached = false, identityConfirmed = false, restoreValue = () => {};
      const cleanups = [];
      const finish = (value, error) => {
        if (finished) return;
        finished = true; clearTimeout(deadline); observer.disconnect(); restoreValue();
        for (const cleanup of cleanups) cleanup();
        error ? reject(new Error(error)) : resolve(value);
      };
      const deadline = setTimeout(() => finish(null, attached ? 'FORGE_UPLOAD_UNCERTAIN' : identityConfirmed ? 'FORGE_UPLOAD_UNAVAILABLE' : 'FORGE_MEDIA_AUTHENTICATION'), ${timeoutMs});
      const observer = new MutationObserver(() => { if (!attached) attach(); });
      const attach = () => {
        if (attached || finished) return;
        if (location.href !== context.repositoryUrl.replace(/\\/$/, '') + '/issues/new') {
          finish(null, 'FORGE_INVALID_MEDIA'); return;
        }
        identityConfirmed = false;
        const marker = document.querySelector('meta[name="user-login"]');
        // 页面身份标记可能尚未插入或水合；没有读取到用户名不能等同于登录了错误账号。
        if (!marker || !marker.hasAttribute('content')) return;
        const username = marker.content.trim();
        if (!username) {
          finish(null, 'FORGE_MEDIA_AUTHENTICATION'); return;
        }
        if (username.toLowerCase() !== context.username.toLowerCase()) {
          finish(null, 'FORGE_MEDIA_IDENTITY_CHANGED'); return;
        }
        identityConfirmed = true;
        const textarea = document.querySelector('textarea[aria-label="Markdown value"]');
        const inputs = document.querySelectorAll('input[type="file"]');
        if (!textarea || inputs.length !== 1) return;
        const input = inputs[0];
        const urls = value => Array.from(value.matchAll(new RegExp('https://github[.]com/user-attachments/assets/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', 'ig')), m => m[0]);
        const previous = new Set(urls(textarea.value));
        const check = () => {
          const url = urls(textarea.value).find(value => !previous.has(value));
          if (url) finish({url});
        };
        const own = Object.getOwnPropertyDescriptor(textarea, 'value');
        const descriptor = own || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
        if (!descriptor?.get || !descriptor?.set || own?.configurable === false) {
          finish(null, 'FORGE_UPLOAD_UNAVAILABLE'); return;
        }
        // React 完成上传后回填受控 textarea.value；监听真实写入，不用轮询猜测上传是否结束。
        Object.defineProperty(textarea, 'value', {
          configurable: true,
          get() { return descriptor.get.call(this); },
          set(value) { descriptor.set.call(this, value); check(); },
        });
        restoreValue = () => { own ? Object.defineProperty(textarea, 'value', own) : delete textarea.value; };
        textarea.addEventListener('input', check); textarea.addEventListener('change', check);
        cleanups.push(() => { textarea.removeEventListener('input', check); textarea.removeEventListener('change', check); });
        const preventSubmit = event => event.preventDefault();
        document.addEventListener('submit', preventSubmit, true);
        const preventClick = event => { event.preventDefault(); event.stopImmediatePropagation(); };
        document.addEventListener('click', preventClick, true);
        const preventShortcut = event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); event.stopImmediatePropagation(); } };
        document.addEventListener('keydown', preventShortcut, true);
        cleanups.push(() => { document.removeEventListener('submit', preventSubmit, true); document.removeEventListener('click', preventClick, true); document.removeEventListener('keydown', preventShortcut, true); });
        // 新版页面可能通过按钮直接调用创建接口；在专用上传页禁用全部提交按钮。
        for (const button of document.querySelectorAll('button[type="submit"]')) button.disabled = true;
        attached = true;
        const bytes = Uint8Array.from(atob(context.image.dataBase64), char => char.charCodeAt(0));
        const transfer = new DataTransfer();
        transfer.items.add(new File([bytes], context.image.filename, {type: context.image.mediaType}));
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', {bubbles: true}));
      };
      observer.observe(document.documentElement, {childList: true, subtree: true, attributes: true, attributeFilter: ['content', 'name']});
      attach();
    });
  })()`;
}
