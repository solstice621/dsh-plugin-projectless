# DeepSeek Harness 不在项目中工作插件

安装并启用后，聊天输入框上方原有的**工作区下拉菜单**会在“添加工作区…”下面增加 **不在项目中工作** 选项。选中后可直接输入消息，无需选择项目文件夹；插件自动为会话分配独立、持久的工作目录。英文界面显示 **No workspace**。不再添加侧边栏“自由聊天”入口。

插件 **0.2.4** 使用官方 `engines.dsh` 声明兼容范围 **`>=0.2.1-rc.3 <0.3.0-0`**：后续 `0.2.x` 正式版及预发布版不会仅因版本号变化被停用；`0.3.0` 及其预发布版需要重新验证。开发依赖和当前集成测试基线仍固定为 **0.2.1-rc.5**。范围声明通过 DSH 自身的版本检查器测试，不代表未来版本的接口变化已经验证。

这里的“无项目”是指不绑定 Workspace；每个会话仍有自己的 cwd，文件和命令工具可以正常使用。

## 安装与使用

源码仓库：[solstice621/dsh-plugin-projectless](https://github.com/solstice621/dsh-plugin-projectless)。

从 [GitHub Releases](https://github.com/solstice621/dsh-plugin-projectless/releases) 下载 `dsh-plugin-projectless-0.2.4.tgz`，或按照下方开发步骤自行构建安装包。

1. 打开 Harness 的 **插件 → 添加插件**。
2. 填入下载或构建好的 `dsh-plugin-projectless-0.2.4.tgz` 的**绝对路径**，安装后选择启用。
3. 点击新会话输入框上方的工作区名称，在菜单中选择 **不在项目中工作**，直接输入消息。模式、模型、权限和输入工具继续使用 Harness 原生控件。
4. 需要使用项目时，在同一菜单中选择已有工作区，或点击 **添加工作区…**。Desktop 使用系统目录选择器，Web 按主机环境使用系统选择器或目录浏览对话框。

从项目切到“不在项目中工作”时会复制未发送的文字草稿；原会话的附件仍保留在原会话中。切回项目由 Harness 原生切换流程处理。

Web 用户也可以从命令行安装并重启对应 profile：

```sh
dsh plugin --profile web add /absolute/path/dsh-plugin-projectless-0.2.4.tgz
dsh web
```

## 目录与保存

默认在运行 Harness 的主机上创建：

```text
~/Documents/DeepSeek Harness/Chats/
└── YYYY-MM-DD/
    └── chat-<随机后缀>/       ← 会话 cwd
        ├── work/
        └── outputs/
```

从项目选择“不在项目中工作”会生成一个新目录和一个空白会话；已选中时再次选择不会重复创建。这些会话不关联项目 Workspace。需要另开聊天时，点击原生“新会话”，再选择“不在项目中工作”。`work/` 和 `outputs/` 提供放置临时文件和成果的目录。会话记录仍由 Harness 保存，发送消息后可在侧边栏的 **未分组** 中再次打开，恢复时使用已保存的 cwd。插件不会自动删除目录，创建会话失败时也会保留已分配的目录。

可在插件配置中设置 `workspaceRoot`，例如 `/Users/your-name/Chats`。必须使用绝对路径；`~` 不会展开。配置仅影响之后创建的聊天。日期按主机本地时间生成。Web 模式下目录位于服务端。

也可以在对应 profile 的 `cordis.patch.yml` 加入：

```yaml
- id: projectless-chat
  config:
    workspaceRoot: /absolute/path/Chats
    maxCachedRequests: 128
```

点击后菜单立即关闭；创建成功时使用 Harness 的实时会话通知打开输入框，只有通知缺失时才刷新会话列表恢复。选择操作会合并同时发生的点击，并对连接中断后的重试使用相同请求标识。成功请求的缓存仅保留在当前 Host 进程中，默认最多 128 条；Host 重启或旧缓存被淘汰后，重试可能创建另一个会话。已保存会话的恢复不依赖这个缓存。

插件通过认证的 RPC 创建会话，仅允许主机所有者调用；会话权限、工具和模型设置沿用 Harness 默认配置。

## 开发

需要 Node.js 24.9 或以上版本。

```sh
npm ci --ignore-scripts
npm run build
npm test
npm pack --ignore-scripts
```

实际 Harness 集成检查：

```sh
npm run test:smoke
```

默认使用 macOS 已安装的 DeepSeek Harness 内置 CLI 和 Google Chrome。其他路径可通过 `DSH_SMOKE_BIN`、`DSH_SMOKE_CHROME` 指定。检查会安装刚打包的插件，验证原菜单入口、草稿切换、键盘重复选择、添加/取消工作区、目录分配、请求重试、流式回复、浏览器刷新、Host 重启和恢复后的相对路径写文件。测试使用临时 `DSH_HOME`、`DSH_AGENTS_HOME` 和本地模拟模型，结束后清理临时配置；结果位于 `test-results/smoke.json`。这不等同于真实 DeepSeek 模型验证。

`src/host.ts` 使用公开 Session Controller 和 Connection Fetch route 创建会话；`src/client.ts` 在公开 `conversation.hero.workspace` slot 注册带“不在项目中工作”选项的菜单，保留真实工作区列表与添加入口。`src/conversation.ts` 为未分组的普通空白会话调用公开 Conversation Factory，以提供可编辑输入框；发出消息后使用 Harness 原生完整聊天页面。注册和注销按顺序完成，并随插件卸载释放。实现无需修改 Harness 源码。

构建分别检查 Host 与 Client 类型，输出 Node 插件和 Harness 模块加载器所需的浏览器模块。上游源码：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)。

MIT 许可。
