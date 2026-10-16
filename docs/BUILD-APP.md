# 用自己的账号创建 AI Studio 应用（Build App）

每个 worker 都会打开同一个 AI Studio 应用页面，并在这个页面里运行本项目的客户端脚本
（`black-browser.js`）。应用只是提供运行环境，生成请求由 worker 通过页面所在账号的会话发出。

**应用必须挂在你自己的 Google 账号下。** 不要使用别人发布的应用链接：对方删除应用、
改为私有或账号被封时，所有 worker 会同时失效。

## 准备

- 一个用来托管应用的 Google 账号。建议使用不在账号池里、不会被轮换或下线的账号；
  它只托管应用，不承担调用量。
- 能登录管理后台（`/` 路径，默认由 management 服务监听 `127.0.0.1:8893`，经反向代理对外）。

## 第 1 步：新建应用

1. 用托管账号登录 <https://aistudio.google.com/apps>。
2. 点 **Build** 新建应用。空白模板或随便一句描述（如 `blank app`）生成的应用都可以，内容会被替换。
3. 不要点 Deploy（部署到 Cloud Run），也不需要填写 API Key。

## 第 2 步：放入客户端脚本

1. 在管理后台打开“配置 AI Studio 应用”，点 **复制客户端脚本**。
   该按钮返回服务器上当前使用的 `black-browser.js`。
2. 在 AI Studio 左侧文件列表中打开入口文件（通常是 `index.tsx`，也可能是 `index.js`），
   **删除全部内容**，粘贴刚才复制的脚本。其他文件不用改。
3. 脚本中的 `ws://127.0.0.1:9998` 保持不变。它连接的是 worker 容器本机的服务。
4. 保存。
5. 右侧预览出现 `[ProxyClient]` 开头的日志即表示脚本已运行。在你自己的浏览器里随后会报
   连接失败，这是正常的（你的电脑上没有 9998 端口的服务）。
6. 如果 AI Studio 提示错误并建议点 **Fix** 让 AI 修复，**不要点**，它会改写脚本。

## 第 3 步：设置共享

1. 点右上角 **Share**，访问权限设为 **Anyone with the link**，账号池里的其他账号才能打开。
2. 复制浏览器地址栏中的链接，格式为
   `https://ai.studio/apps/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`。
   `aistudio.google.com/apps/...` 和带 `/drive/` 的形式也能识别。

## 第 4 步：在服务器上启用

1. 在管理后台“应用链接”中粘贴链接，点 **保存**。链接写入两个槽位的
   `dual-runtime/slots/{A,B}/worker.env`（`TARGET_URL=`），不进入代码仓库。
2. 点 **立即生效**：A、B 依次换号重启并加载新应用（每个约 1–2 分钟）。
   不点的话，会在下次换号时生效。

## 验证

- 应用链接可访问：
  `curl -s -o /dev/null -w '%{http_code}\n' https://ai.studio/apps/<id>`
  返回 301（跳转到 `aistudio.google.com`）是正常的，返回 404 说明应用已被删除。
- worker 日志中出现 `[ClientScriptObservation]`，其中 `features.ProxySystem` 为 `true`，
  说明客户端脚本已在应用页面中运行。
- 生成请求日志出现 `[GCBridge] <model> unary ok` / `stream ok`。
- 通过正式入口发一次 Gemini 和一次 OpenAI 格式请求，均返回 200。

日志里每隔一段时间出现 `wss://ais-dev-….run.app` 相关报错不代表应用失效，
那是应用 iframe 自身开发通道的噪音。

## 更新客户端脚本

`verified-client-route.js` 只会把**已知哈希**的应用脚本自动替换为服务器上的
`black-browser.js`。如果你的应用里粘贴的脚本哈希不在列表中，worker 会直接运行应用里的脚本；
此时修改了 `black-browser.js` 后，需要重新执行第 2 步把新脚本粘贴进应用。

## 回退与注意事项

- 切换前记下旧链接。新应用有问题时，把旧链接保存回后台并点“立即生效”即可恢复。
- 不要公开应用链接；不要删除应用或改回私有，否则需要重新配置。
- 托管账号如果被封或删除，应用随之失效。按本流程用另一个账号重新创建即可。
