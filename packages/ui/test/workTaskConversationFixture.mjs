export async function routeWorkTaskConversationFixture(page) {
  // 在 SessionPane 的公开边界核对绑定，不启动真实模型。
  await page.route("**/packages/ui/src/v4/SessionPane.tsx*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export function SessionPane(props) {
      const React=window.__React;
      React.useEffect(()=>{if(props.onAcpSessionArchived)window.__tasks.closed.push(props.onAcpSessionArchived)},[props.onAcpSessionArchived]);
      return React.createElement('div',{'data-testid':'work-task-fixture-session','data-kind':props.acpBoundSessionId?'acp':'api','data-session':props.acpBoundSessionId??props.sessionId,'data-workspace':props.workspacePath,'data-readonly':String(!!props.readOnly),className:'flex h-full flex-col p-4'},
        React.createElement('p',null,'Synthetic conversation: '+(props.acpBoundSessionId??props.sessionId)),
        React.createElement('textarea',{'aria-label':'Synthetic conversation draft',disabled:props.readOnly,className:'mt-auto border border-border p-2'}));
    }`,
    }),
  );
  await page.route("**/packages/ui/src/v4/V4ConversationContext.tsx*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: "export function V4PaneConversationProvider({children}) {return children} export function useHasV4Conversation(){return false} export function useV4Conversation(){throw new Error('Pending task must not connect to a conversation')}",
    }),
  );
}
