# LinkPilot

网络中继与网关控制面板的安全优先 MVP。当前交付的是可运行的前端原型，不是路由器固件或 VPN 服务端。

## 本地运行

需要 Node.js 20.9 或更新版本。

```powershell
npm ci
npm run dev
```

在浏览器打开 `http://localhost:3000`。生产检查：

```powershell
npm run lint
npm run build
```

## 代码结构

- `app/page.tsx`：主控制台与交互状态。导航切换总览、路由策略、协议目录和操作记录；路由表单生成仅驻留内存的草稿，并允许导出 JSON。
- `app/globals.css`：运维控制台样式、状态色、表格、图表占位、移动端布局和减少动画偏好支持。
- `app/layout.tsx`：中文文档语言、站点标题及全局字体。
- `.github/workflows/ci.yml`：推送/PR 时运行 ESLint 和生产构建。

## 状态与演示数据

默认没有连接任何 Agent：节点显示“未接入”，延迟、丢包和吞吐为 `—`，操作不会触达服务器。右上角“演示数据”开关开启后，页面展示标有“演示”的静态示例；它不代表真实线路。路由草稿只存在当前页面内存中，刷新或离开页面即丢失；导出操作仅下载 JSON，应用按钮保持禁用。

协议目录包含 Gost、Realm、SD-WAN、L2TP、OpenVPN、WireGuard、IPsec/IKEv2。它们目前只是计划接入的能力目录，尚未实现管理 API、服务端 Agent、协议适配器、真实遥测或设备配置下发。

## 生产化边界

完整的路由/SD-WAN 控制需要独立的受认证 Agent 和最小权限执行器。建议先定义版本化 API、设备身份与 mTLS、RBAC、签名配置、变更审批/回滚、审计存储和探测上报，再逐个实现 Gost/Realm/VPN adapter。不要让公开 Web 前端持有 SSH/root 凭据，也不要通过浏览器直接执行 shell 命令。

此仓库可公开；不要提交私钥、API token、服务器配置或个人节点链接。`.env*` 已被 Git 忽略。
