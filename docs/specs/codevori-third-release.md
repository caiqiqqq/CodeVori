# CodeVori 第三个安装版本

## 产品规则与交付范围

- 新版本为 `1.0.2`，根 `package.json` 继续作为版本唯一来源，安装包、应用信息及构建元数据保持一致。
- 本轮提交并推送已完成的 [ACP 调用轨迹完善](acp-execution-trace.md)、相关协议、实现及测试到 `private/main`；生成的 sourcemap 和安装包不入库，无关本地改动保留。
- 从推送成功且核对一致的固定提交创建独立构建 worktree，重新编译桌面、内置 Agent 和 Computer Use 插件，生成 macOS arm64 DMG 与 ZIP，不覆盖开发版产物或用户数据。
- 复用既有 CodeVori 品牌、免登录启动、官方应用升级禁用及用户数据兼容规则。仅交付本地安装包，不发布 GitHub Release。
- 沿用本地 ad-hoc 签名；验证签名完整性并如实记录 Apple 公证和 Gatekeeper 状态。

## 所有者与交付顺序

```text
根版本与已验证源码 → 提交 → 推送 private/main → 核对远端 commit
                   → 独立 worktree 编译 → 打包与资源闭包校验
                   → 临时用户目录启动检查 → DMG / ZIP / SHA-256 / 构建来源
```

- 应用版本由根 manifest 持有，现有 build metadata 关联精确提交及构建时间。
- ACP 会话事实继续由目标 Host 持有；构建和启动验证均不读取真实会话或发送模型请求。
- 只有远端提交一致且最终安装包验证完成后才宣告交付；网络、编译或打包失败分别处理。

## 验收

1. `private/main` 与本地提交一致；ACP 调用轨迹的 spec、实现和测试完整入库，`schedulerProtocol.d.ts.map` 保持未跟踪。
2. 类型检查、Lint、架构及改动格式检查通过，真实记录已有警告；保留此前 53 项 ACP 相关测试与交互 E2E 的结果。
3. 产物为 CodeVori `1.0.2` / macOS arm64，使用临时数据目录实际启动，显示免登录主窗口并保持官方更新器禁用。
4. ASAR 中的桌面产物与本次新构建一致，运行时依赖闭包、平台资源、Agent、Computer Use 插件及签名完整性通过校验。
5. DMG / ZIP 完整性通过，交付文件记录版本、精确源码提交、大小与 SHA-256。
