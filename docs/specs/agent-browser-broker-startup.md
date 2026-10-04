# Agent 浏览器通信端点启动

## 产品规则与所有者

- Node REPL 浏览器 broker 是通信端点、私有临时目录、启动 Promise 与关闭 Promise 的唯一所有者。API/ZCode 会话和 ACP 插件能力读取复用同一 CLI 启动实现，不在 ACP 层忽略插件读取失败，也不改动已配置的插件、MCP、凭据或会话历史。
- POSIX 启动先在 `os.tmpdir()` 下创建进程独占的私有目录，再绑定 Unix socket。继承的临时目录不存在、不可访问、不是目录，或 socket 路径超过跨平台安全长度时，只尝试一次 `os.homedir()` 下的独占目录；不复活外部进程已清理的目录，不修改全局环境或已有目录权限。测试可以通过 broker 的 `socketRootDirectories` 输入注入候选根目录。
- 独占目录通过异步 `mkdtemp` 创建，保持 `0700` 权限；socket 使用短文件名，并在绑定前检查 UTF-8 字节长度（最多 103 字节）。不同 broker 不共享 socket 或目录。Windows 继续使用随机 ID 的命名管道，不创建或删除文件系统目录。
- `ready` 成功后才允许读取 `socketPath`、注入 Node REPL 的连接材料或对外接受协议请求。启动成功后 socket 不阻止进程自然退出。失败只在端点层按结构化错误码处理；不可恢复错误保持原始原因并向 CLI 入口传播，不能伪造成功或返回空插件列表。
- 正常关闭、启动中立即关闭与重复关闭都复用同一个关闭 Promise。关闭先等待启动收口，再停止监听，最后仅删除自己的 socket 和空目录；不递归删除候选根目录或其他 broker 的文件。启动失败后也清理已创建的目录，不删除用户已有文件。

## 事件顺序与边界

```text
CLI 启动 → broker owner → 创建独占目录 → 绑定 socket → ready
                            │失败且可恢复                 │
                            └→ 清理本次目录 → 用户目录重试  ├→ 协议握手/API 会话
                                                       └→ ACP 插件能力读取 → 原生 ACP 会话恢复
CLI 关闭 → 同一 broker owner → 等待 ready 收口 → 停止监听 → 清理自己的端点/空目录
```

目录和路径不进入会话持久化，不新增环境变量或公共 RPC。Host owner/lease、workspace identity、ACP connection generation 与 Desktop continuous/mobile replayable 的现有语义均保持不变；只在目标环境的 CLI 端点初始化边界恢复失败。

## 验收场景

1. 正常临时目录：真实 socket 请求保留 token、session 与 subagent 权限检查；关闭后独占目录消失，候选根目录和已有文件仍在。
2. 继承不存在的临时目录、无写权限目录、非目录路径或超长路径：使用私有备用目录，正常通信；原目录不被创建、chmod 或删除。
3. 多个 broker 并发启动互不影响；立即关闭及重复关闭不泄漏后续才绑定的端点。绑定失败后只清理已创建的目录，全部候选不可用时 `ready` 明确失败。
4. Windows 命名管道路径及无目录操作保持兼容；当前平台不能运行的跨平台场景明确标注未实测。
5. 使用不存在的 `TMPDIR`/`TMP`/`TEMP` 启动实际 CLI，完成只读协议握手和插件能力读取；API/ZCode 与 ACP 的现有测试通过。桌面加载新 CLI 后不再出现该原因导致的 `stdout_closed` 和反复重启，不发送收费模型请求。
