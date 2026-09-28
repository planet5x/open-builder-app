# Open Builder 安全与质量基线

更新时间：2026-08-28

本文件记录当前实现边界和发布前验证口径，不替代变更日志，也不把本地静态检查等同于真实模型、设备或生产验证。

## 1. 产品边界

- 产品采用桌面优先定位。Web 与实验性移动端不提供 stdio MCP、本机进程或 Skill 脚本执行。
- 保留现有凭证字段、持久化 key、存储位置和默认保存行为。设置与 API Key 仍存放在浏览器本地存储中，不宣称存在加密 vault；浏览器配置文件和设备属于凭证安全边界。
- 桌面端保持对话在左、工作区在右的横向可调分栏；iPad/Android 平板使用工作区在上、对话在下的纵向可调分栏；手机端保持对话优先并使用内嵌预览。
- 紧凑布局的会话列表通过全视口抽屉呈现，点击遮罩关闭时不能由抽屉内容点击误触发。
- 移动端保留紧凑控件尺寸，不统一扩大到 44×44 px；无障碍完善集中在语义、Tooltip、焦点、键盘顺序和状态反馈。

## 2. 工具与运行权限

工具 schema 展示和执行入口共同依赖中央能力表。能力表声明工具来源、效果、平台、运行模式和审批要求；当前运行未授权或未知的 MCP/自定义工具会在执行入口再次拒绝。

| 运行环境     | 允许能力                                                                        |
| ------------ | ------------------------------------------------------------------------------- |
| Desktop Chat | 用户启用的项目、网络和 MCP 能力；Skill 脚本必须开启开发者开关并逐次确认         |
| Plan         | 非秘密只读工具，以及明确标记为只读且允许 Plan 的 MCP                            |
| Auto QA      | 项目检查、非秘密读取及必要项目修复；无 MCP、Skill、registry、秘密读取或本机进程 |
| Subagent     | 独立的非秘密项目快照、父级自定义指令快照、所选 Skill 与显式允许的只读 MCP       |
| Web/Mobile   | 无 stdio MCP 和本机脚本；远程 MCP 仅允许 HTTPS                                  |

每次 Chat、Plan 或 retry 会在开始时快照自定义指令；Plan 获批后的同一轮续跑保持原快照。Skill 激活状态向子代理传递的是独立快照而非共享可变状态，手动选择 Skill 时全文规则随请求传递；工具策略版本变化会使旧授权失效。自动 QA、智能标题和上下文压缩使用独立提示词，不接收自定义指令。

## 3. 秘密、网络和本机边界

- `.env`、私钥、证书和凭据文件不会进入普通文件读取、搜索、模型项目清单、子代理快照或 Sandpack 预览。环境变量只通过不返回值的 schema 工具暴露名称。
- Sandpack 只接收前端预览 allowlist 中的文件；应用设置中的凭证不会投影到预览环境。
- 项目规范、远程设计文档和组件 registry 内容均作为不可信参考数据，不进入 system role。内置设计资料固定到不可变提交；自定义 registry 首次使用需要确认 origin，并禁止写入项目规范文件。
- 反向代理保留原始 HTTP/HTTPS scheme，校验每次 DNS 解析和重定向，拒绝未显式允许的私网、链路本地和 TLS 降级目标。远程 MCP 强制 HTTPS；携带凭据时不提供明文传输例外。
- 原生 AI/MCP 流具备累计字节、速率、空闲时间、总时长和有界队列限制；超限会取消上游连接。
- Firecrawl 对新安装和重置设置默认启用，未填写 Key 时不发送空鉴权头并受服务端按 IP 限额约束；填写 Key 可提高限额。Exa 必须填写 Key 才会注册联网工具。两者的网页读取均受现有 URL 校验、数量、并发、超时和内容截断限制保护，失败页面降级到 Jina Reader。
- Skill ZIP 在流式读取过程中执行文件数、单文件大小、累计大小和压缩比限制。
- 内置 Skill 首次安装默认允许 metadata 自动发现；系统提示词只列出名称、ID、版本、标签、工具权限与描述，AI 调用 `read_skill` 后才加载正文。工具栏手动选择会把全文放入下一次请求的强制上下文并在发送后清空。
- 导入 Skill 默认关闭自动发现，用户审核并开启后才提供 metadata；同名内置 Skill 不覆盖用户文件。桌面 Skill 脚本逐次展示来源、内容哈希和完整参数；执行时清空继承环境、使用隔离工作目录并终止完整进程组。
- 高级设置中的自定义指令仍以内部 `<custom_system_prompt>` 边界追加，最长 32,000 字符；超限在调用模型前失败且不截断。该内容会发送给模型服务商，但不能授予工具、扩大权限或弱化平台和模式约束，且不应包含秘密。

> 已知保留风险：桌面 Skill 脚本尚未具备跨平台、可证明的强网络/文件系统沙箱，因此默认关闭。逐次确认、隔离环境和资源限制是当前的纵深防御，不等同于完整沙箱。

## 4. 本地数据生命周期

- `/clear` 只清除消息、压缩摘要和当前输入，保留项目文件。
- “重置项目”经确认后统一清除消息、摘要、文件、初始化状态、模板状态和快照。
- Sandpack 编辑（包括空字符串）立即写入内存，并在文件切换、会话切换和卸载前强制 flush。
- 附件以独立 Blob + 引用方式保存，消息中不长期持久化 data URL。PDF 不在本地提取文本；调用模型时读取 Blob，并以原生 `application/pdf` 文件 part 发送给支持 PDF 的模型。
- 会话持久化 `activeFile`，文件消失时回退到首个有效文件。
- “清除所有数据”通过统一存储域注册表执行并等待完成，覆盖设置、会话、附件、快照、记忆、模板、MCP 与 Skill 元数据/文件。此流程只保证用户明确全量清除时删除现有数据，不改变凭证的日常存储实现。
- 设置存储 schema 为版本 19；旧数据迁移时将缺失的 `customSystemPrompt` 与 Exa Key 初始化为空字符串，不改变已有联网搜索引擎选择，清空自定义指令字段即停用。
- 权限活动记录只保存在本机、固定长度且默认脱敏，不记录凭证值，也不上传遥测。

## 5. UI、性能与工程治理

- 保留现有工作区和视觉体系；对话初始区域只保留带不可见分组标签的快捷建议。Skills 与 MCP 弹窗桌面宽度限制为 576 px；输入栏图标按钮使用固定尺寸、共享 Tooltip、键盘焦点和 ARIA 状态。
- 设置在桌面保持弹窗结构；小屏优化滚动、固定操作区和裁切。只有一个 API 运行选项时隐藏整组“运行方式”，能力检测、错误、已保存 Local CLI 或确认支持 Local CLI 时仍显示恢复路径。Automatic QA、可访问的自定义指令输入与权限活动记录集中在独立的“高级设置”页签。自定义指令固定为三行、不允许拖拽，聚焦时边框颜色不变化但保留外部键盘焦点环；超限仍显示关联错误。预览设备模式支持 scale-to-fit、缩放和滚动。
- 长消息采用动态高度虚拟列表；Settings、MCP、Skills、Markdown/Diff 与 Sandpack 相关界面按需加载。
- `package.json` 是应用版本的唯一来源；`pnpm version:sync` 同步 Cargo、Tauri 和 MCP client identity，CI 使用 `pnpm version:check` 防止漂移。
- `pnpm typecheck`、ESLint `pnpm lint`、Prettier `pnpm format:check`、Vitest、桌面安全脚本和 Rust fmt/clippy/test 构成静态质量门禁。
- 仅有一个 `v*` Release 工作流：质量门禁通过后，由桌面构建矩阵更新同一个 draft release。iOS/Android 仅保留手动实验性工作流。第三方 Actions 固定到完整提交 SHA。

## 6. 验证口径

本地发布前应执行：

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm version:check
pnpm workflow:check
pnpm test
pnpm test:components
pnpm security:desktop
pnpm build
pnpm build:check

cd src-tauri
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
```

E2E 默认关闭。真实模型/PDF 能力、真实移动设备、Tauri 子 frame 对 `proxy-http://` / `proxy-https://` 的可达性、GitHub branch/tag/environment 保护、Cloud 和生产发布都需要单独授权与对应环境验证；本地单元测试或构建通过不能证明这些外部状态。
