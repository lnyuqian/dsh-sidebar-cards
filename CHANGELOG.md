# CHANGELOG

## 0.1.0 — 2026-11-12

首个可用版本：左侧栏会话浏览区整体替换为 5 张卡片。

### 新增

- 五张卡片：插件（官方导航 + DS Bot）、一周会话、置顶会话、自动化任务会话、工作区
- 卡片标题行：30px 高、`#e3e3e3` 背景、15px/700、右侧收起箭头、滚动吸顶
- 折叠状态记忆（localStorage `dsh.sidebarCards.v2.*`）
- 一周会话按「今天 / 昨天 / 本周」分组；最近 7 天窗口
- 置顶 / 自动化卡片默认收起，展开一次 10 条 + 「显示更多」
- 工作区：最近点击的 2 个展开，每个前 15 条 + 「显示更多」；右侧保留原 3 个图标（搜索 / 视图 / 新建），最右为收起箭头
- 卡片宽度 `calc(100% - 4px)` 居中，随侧栏宽度自适应
- 空卡自动隐藏
- 会话行菜单：置顶 / 取消置顶、归档 / 取消归档、复制会话 ID
- 会话拖拽排序（`insertSessionBefore`）
- 视图选项：分组 / 平铺 / 显示归档
- 搜索：按标题与目录过滤
- 官方导航 `<nav>` 与 DS Bot 行以 DOM 搬移方式并入「插件」卡，行为不变、卸载时自动还原

### 数据来源

- 工作区 / 置顶集合：Remote `workspace.follow`（实时流）
- 会话：Remote `session.list({})`（标题取自 `projections.values.title`）
- 自动化任务：Remote `schedule.list({ active: true })`
- 兜底：Host 侧 `/sidebar-cards/data`、`/sidebar-cards/act`（浏览器侧拿不到鉴权时自动跳过）

### 修复（开发过程中）

- `workspace.follow` 是无限流，不能用 `await` 阻塞后续数据拉取 → 改后台执行
- `ctx.uiWorkspace` 属性访问在未 inject 时抛错，导致点击无反应 → 统一改用 `ctx.get('uiWorkspace')`
- 会话标题藏在 `projections.values.title`，深层取值白名单缺 `values` → 补齐
- `session.list` 需要一个业务参数 → 传 `{}` 并准备备选参数形态

### 终版交互修正

- 卡片吸顶：滚动容器顶部内边距归零 + 6px 占位，`position: sticky; top: 0` 与卡片上沿对齐（此前会吸进内边距、视觉上超出卡片约 5px）
- 搜索：点 🔍 自动展开「工作区」卡（此前卡收起时输入框不渲染，看起来“没反应”）；实时过滤 + 命中条数；回车/ESC 生效
- 工作区展开：严格只保留最近点击的 2 个展开（点第 3 个会收起最早的）
- 一小时会话 / 置顶 / 自动化卡片默认状态按需求固定（插件、一周展开；置顶、自动化收起）

### 工作区行动作调整（用户指定）

- 卡片标题行保留 3 个图标：搜索 / 视图选项 / **新建工作区**
- 每个工作区行右侧**只保留「＋」，绑定为「在该工作区新建会话」**（`uiWorkspace.startSession(workspaceId)`），去掉此前的搜索与视图图标

### 工作区对齐与图标配色（用户指定）

- 「工作区」卡片标题行右侧的搜索 / 视图 / ＋ 整组右移：标题行右内边距由 8px 改为 12px（= 工作区行 4+8），箭头与图标间距固定 7px，使标题行 ＋ 与每个工作区行的 ＋ 右边缘对齐，搜索/视图随之前移
- 工作区行的 ＋：默认 `#e9e9e9` 浅灰，鼠标悬停到该 ＋ 上变为常规色 `#4d4d4d` 并带浅底

### 启动闪屏修正

- 侧栏数据就绪前不再渲染任何临时文字/诊断内容（此前会短暂闪出「正在加载会话…」与诊断卡），改为极轻的占位色块，加载完成后直接呈现卡片

### 标题行水晶玻璃质感（用户指定 08 + 05）

- 5 张卡标题行默认使用 **08 磨砂玻璃**：`linear-gradient(半透明白) + radial-gradient(左上柔光) + uiGradients·Above The Sky 灰底`，`backdrop-filter: blur(6px)`，叠加 1px 顶部光边、底部内折射亮线、底部厚度阴影
- **选中卡**（当前打开会话所属卡片）切换为 **05 混凝土**：`uiGradients·Risky Concrete` 三段灰 + 同套玻璃光边，深浅对比形成层级
- 当前会话 id 记在 `localStorage` 的 `dsh.sidebarCards.v2.activeSessionId`，重启后仍能高亮上次所在卡片

### 会话行去标签（用户指定）

- 「一周会话 / 置顶会话 / 自动化任务会话」三张汇总卡不再显示行右侧的工作区小标签，只保留标题与时间；工作区标签仅在「平铺视图」保留

### 只显示主会话（用户指定）

- 会话列表按官方语义过滤**子代理会话**：行数据带 `parentSessionId`（或 `origin: 'subagent'`）的一律不进入 一周会话 / 置顶 / 自动化 / 工作区 / 平铺 各列表
- 依据：Host `sessionController.list()` 的子代理行带有 `parentSessionId` + `origin`（实测 555 行中 435 行带子代理相关字段，过滤后只剩主会话）

### 已知限制

- DSH 会话列表接口不含 `createdAt`，「一周会话」的 7 天窗口与「今天/昨天/本周」分组暂用 `updatedAt` 近似（标题与时间显示不受影响）
- 未做虚拟滚动；会话量极大时首次渲染略慢
- 官方导航 / DS Bot 为 DOM 搬移，官方大幅改版时需复核

## 未发布

### 变更（用户 2026-11-13）

- 五张卡片合并为一个大卡片：卡间间距 gap 6px → 0；卡片自身的白底 / 8px 圆角 / 1px 描边统一收到外层容器 .dsc-stack，段与段之间用 1px 分隔线
- 卡片宽度对齐左栏「新建会话」按钮：.dsc-root 左右 padding 4px → 8px（官方侧栏 padding 12px、regionArea 左右负 margin 后，8px 正好等于按钮的 margin:0 2px 内缩），卡片宽度改为容器 100%；另加运行时实测按钮宽度写入 --dsc-card-w 作为兜底
- 首张卡片标题行保留 8px 上圆角、末张卡片内容区保留 8px 下圆角；折叠卡片的标题行在中间段为直角

### 修订（用户 2026-11-13，第 2 版）

- 撤回「合并为一个大卡片」：恢复 5 张独立卡片，卡间间距 **4px**
- 每张卡片恢复自己的背景框（白底 + 8px 圆角 + 1px 描边），标题行 order-radius:8px 8px 0 0 与卡片上沿吻合，标题行 width:100% + ox-sizing:border-box，不再出现「标题条浮在背景上」的两层感
- 卡片宽度继续对齐左栏「新建会话」按钮（--dsc-card-w 运行时实测 + .dsc-root 左右 8px）

### 修订（用户 2026-11-13，第 3 版）

- 标题行彻底与卡片重合：卡片加 overflow:hidden 由卡片圆角裁切，标题行 order-radius:0、width:100%、margin:0，顶部与卡片上沿严格对齐，不再有圆角处透白造成的「窄一截」
- 卡片间距 4px（第 2 版已设，本轮复核保留）

### 修订（用户 2026-11-13，第 4 版）

- 移除运行时按钮宽度测量：它命中了错误的元素，把卡片宽度算小，导致卡片变窄居中、两侧露白（表现为「标题条浮在背景上」）
- 卡片宽度改为容器 100%，.dsc-root 左右 padding 8px → 6px（按无障碍树实测：侧栏内容区 256px、新建会话按钮 244px，6px×2 正好补齐 12px 差值）
- 收起状态：.dsc-card.dsc-collapsed 背景透明、去描边、overflow:visible，标题行自带 8px 圆角 —— 只看到标题，卡片背景隐藏
- 展开状态：卡片白底 + overflow:hidden 裁切，标题行 order-radius:0 满宽，顶部与卡片上沿严格对齐

### 修订（用户 2026-11-13，第 5 版）

- 卡片水平居中：官方 egionArea 左边界比右边界多缩进 12px，纯 CSS 无论 padding 怎么调，卡片中心都会偏右 6px
- 改为运行时读取侧栏 side 与 .dsc-root 的实际左右留白，动态补 padding-right（并扣除垂直滚动条宽度），使卡片左右留白相等
- CSS 兜底 padding-right:16px，JS 未执行时也不会偏太多

### 修订（用户 2026-11-13，第 6 版）

- 参照物由 side 改为官方「新建会话」按钮（[class*="newSession"]，命中失败时按文本 + 位于卡片上方 + 宽度 >100 兜底）
- 卡片左右边界直接对齐按钮左右边界：padLeft = 按钮.left − root.left、padRight = root.right − 按钮.right，同时拿到「居中」和「与按钮同宽」
- CSS 兜底按实测改为 padding: 0 14px 10px 2px（实测卡片 [1270,1520] vs 按钮 [1272,1516]）

### 诊断（用户 2026-11-13，临时）

- 侧栏顶部加一行 DBG v7 ... 探针，输出：卡片宽高、标题行宽高、相对卡片偏移 dx/dy、是否带 dsc-collapsed 类、卡片计算背景色、标题行左右 padding、标题行圆角
- 目的：确认「标题不贴顶 / 不重合 / 收起仍有白框」到底是 CSS 未生效还是 class 未加
- 定位后立即移除
- 卡片改为 flex column 布局（lex:0 0 30px 标题行），排除 block 布局下的意外偏移

### 修复（用户 2026-11-13，据诊断数据）

诊断读数：card=250x52 head=224x30 dx=13 dy=11 col=1 bg=rgb…

- 标题行比卡片窄 26px、上偏 11px，且 dsc-collapsed 类已加但背景仍是白色 → 宿主全局样式（<section>）压过了 .dsc-card 的布局与背景规则
- 卡片布局属性全部加 !important：display:flex / flex-direction:column / align-items:stretch / justify-content:flex-start / width:100% / margin:0 / padding:0 / background / border-radius / box-shadow / overflow
- 收起态 ackground:transparent !important、ox-shadow:none !important
- 标题行 width:100% / height:30px / margin:0 / padding:0 12px / flex:0 0 30px 全部 !important（背景与圆角不加，保留内联玻璃质感）

## 0.1.1 — 2026-11-13（DSH 0.2.2-rc.1 实测）

### 布局

- 5 张独立卡片，卡间间距 4px；卡片左右边界对齐左栏「新建会话」按钮（运行时读取按钮 rect，逐边对齐）
- 标题行与卡片同宽、贴卡片顶端：卡片 \overflow:hidden\ 由圆角裁切，标题行 \order-radius:0\、\width:100%\、\margin:0\
- 收起状态只显示标题：\.dsc-card.dsc-collapsed\ 背景透明、去描边、\overflow:visible\，标题行自带 8px 圆角

### 关键修复（宿主样式冲突）

诊断读数 \card=250x52 head=224x30 dx=13 dy=11 col=1 bg=rgb…\ 证明：**DSH 0.2.2-rc.1 对 \<section>\ 有全局样式**（内边距 + 居中对齐 + 背景），
会压过插件的布局规则。现已对关键属性统一加 \!important\。

### 移除

- 移除临时诊断探针（侧栏顶部 \DBG\ 行）
