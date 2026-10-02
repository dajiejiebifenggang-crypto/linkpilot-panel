# LinkPilot

安全优先的网络中继控制面 MVP。v0.2 增加自托管控制 API 与 Linux 遥测 Agent，可登记服务器并查看实时系统状态和已登记节点间的 TCP 探测。GitHub Pages 只托管静态前端；真实数据需要单独运行控制 API。

## 本地开发

需要 Node.js 20.9+。在两个 PowerShell 终端运行：

```powershell
npm ci
$env:LINKPILOT_ADMIN_TOKEN = ([guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N'))
$env:LINKPILOT_ALLOWED_ORIGINS = 'http://localhost:3000'
npm run api
```

另一个终端运行 `npm run dev`，打开 `http://localhost:3000`。在“服务器接入”页填 `http://localhost:8787` 和刚生成的令牌。管理员令牌只留在当前页面内存，不写入 `localStorage`。

```powershell
npm run test:control
npm run lint
npm run build
```

完整 Linux/Docker、TLS 反代、FRP/NAT 与 Agent 部署步骤见 [docs/deployment.md](docs/deployment.md)。

## v0.2 已实现

- 一次性、15 分钟有效的 Agent 注册令牌；注册后生成独立节点令牌，服务端仅存哈希。
- Debian/Ubuntu/CentOS Stream/RHEL 系 Linux Agent 每 10 秒上报 CPU、内存、磁盘、运行时间和网卡吞吐；系统配置详情包含发行版、内核、CPU/容量和网卡名称，不收集 MAC/IP。
- 控制台每 5 秒刷新，显示最近 360 个样本；连续 30 秒无心跳视为离线。
- 对管理员登记的节点端点执行 3 次 TCP connect 探测，展示 RTT 和 TCP 连接失败率；FRP 模式可使用 FRPS 映射端点。
- Agent systemd 服务使用专用无登录 `linkpilot` 用户；服务只采集和上报，不执行任意 shell 命令。
- API 默认绑定 `127.0.0.1`，管理员令牌至少 32 字节；远程 Agent 控制链接必须 HTTPS。跨域来源通过精确的 `LINKPILOT_ALLOWED_ORIGINS` 配置。

## 代码结构

- `app/page.tsx`：控制台导航、路由草稿和总览。
- `app/server-console.tsx`：API 连接、内存令牌状态、服务器登记向导、实时指标和节点互探。
- `control/server.mjs`：无第三方运行依赖的 Node HTTP API、鉴权、一次性注册、状态存储与遥测校验。
- `control/server.test.mjs`：端到端测试注册令牌重放、认证、心跳和节点互探。
- `agent/agent.mjs`：Linux 只读采集器、心跳、探测和受限 systemd 安装。
- `agent/install.sh`：Linux 一键安装入口。
- `compose.yaml` / `Dockerfile`：自托管前端和 API 服务。
- `.github/workflows/ci.yml`：运行 API 测试、ESLint、构建并发布 GitHub Pages。

## 尚未实现

当前 mesh 视图是 TCP 可达性探测，不会创建 WireGuard/IPsec 隧道；路由分流仍是本地草稿。Gost、Realm、SD-WAN、L2TP、OpenVPN、WireGuard 和 IPsec/IKEv2 目前为能力目录，尚无真实安装/配置适配器、密钥生命周期、审批/回滚或服务端执行流程。不要将当前版本当作爱快替代品或直接用于无人值守的生产网络变更。

API 使用单实例 JSON 状态文件，不提供 HA、多写入器或数据库备份策略。公开仓库不要提交 `.env`、节点链接、服务器凭据或私钥；运行时 `.env*`、Agent 凭据和数据目录均被 Git 忽略。
