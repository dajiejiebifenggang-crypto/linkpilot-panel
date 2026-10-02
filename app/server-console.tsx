"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Activity, Cable, Check, Copy, Globe2, LockKeyhole, Plus, RefreshCw, Server, ShieldAlert, Trash2, Wifi } from "lucide-react";

type Metrics = {
  cpuPercent: number;
  memoryPercent: number;
  diskPercent: number;
  diskTotalBytes: number;
  uptimeSeconds: number;
  rxMbps: number;
  txMbps: number;
  sampledAt: number;
};

type AgentNode = {
  id: string;
  name: string;
  region: string;
  address: string;
  probePort: number;
  accessMode: "direct" | "frp";
  status: "online" | "offline";
  lastSeen: number | null;
  ageMs: number | null;
  agentVersion?: string;
  system?: { hostname: string; os: string; platform: string; kernel: string; architecture: string; cpuCount: number; cpuModel: string; memoryTotalBytes: number; diskTotalBytes: number; interfaces: string[] };
  metrics: Metrics | null;
  history: Array<{ at: number; cpuPercent: number; memoryPercent: number; rxMbps: number; txMbps: number }>;
};

type Link = { sourceId: string; peerId: string; latencyMs: number; lossPercent: number; samples: number; checkedAt: number };
type Telemetry = { generatedAt: string; nodes: AgentNode[]; links: Link[] };

const rawAgentUrl = "https://raw.githubusercontent.com/dajiejiebifenggang-crypto/linkpilot-panel/main/agent/install.sh";

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function elapsedLabel(ageMs: number | null) {
  if (ageMs === null) return "尚未上报";
  if (ageMs < 30_000) return `${Math.max(0, Math.floor(ageMs / 1000))} 秒前`;
  return `${Math.floor(ageMs / 60_000)} 分钟前`;
}

function uptimeLabel(seconds: number) {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  return days ? `${days} 天 ${hours} 小时` : `${hours} 小时`;
}

function byteLabel(bytes: number) {
  if (!bytes) return "—";
  const gib = bytes / 1024 ** 3;
  return `${gib >= 10 ? gib.toFixed(0) : gib.toFixed(1)} GiB`;
}

export default function ServerConsole({ onNotice }: { onNotice: (message: string) => void }) {
  const [apiUrl, setApiUrl] = useState("http://localhost:8787");
  const [adminToken, setAdminToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [updatedAt, setUpdatedAt] = useState("");
  const [showEnrollment, setShowEnrollment] = useState(false);
  const [installCommand, setInstallCommand] = useState("");
  const [copied, setCopied] = useState(false);
  const [serverName, setServerName] = useState("");
  const [region, setRegion] = useState("US · Los Angeles");
  const [probeAddress, setProbeAddress] = useState("");
  const [probePort, setProbePort] = useState("443");
  const [accessMode, setAccessMode] = useState<"direct" | "frp">("direct");
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  async function fetchTelemetry(url: string, token: string) {
    const response = await fetch(`${url}/api/v1/telemetry`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `API 返回 ${response.status}`);
    setTelemetry(payload as Telemetry);
    setUpdatedAt(new Date().toLocaleTimeString());
  }

  async function connectApi(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const normalized = new URL(apiUrl).origin;
      const parsed = new URL(normalized);
      if (parsed.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
        throw new Error("远程控制 API 必须使用 HTTPS；本机 localhost 可用 HTTP。");
      }
      const healthResponse = await fetch(`${normalized}/api/v1/health`, { cache: "no-store" });
      if (!healthResponse.ok) throw new Error("控制 API 健康检查失败。");
      await fetchTelemetry(normalized, adminToken.trim());
      setApiUrl(normalized);
      setConnected(true);
      onNotice("控制 API 已连接；令牌仅保存在当前页面内存中。");
    } catch (cause) {
      setConnected(false);
      setError(cause instanceof Error ? cause.message : "连接失败");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!connected) return;
    let stopped = false;
    const refresh = async () => {
      try {
        const response = await fetch(`${apiUrl}/api/v1/telemetry`, { headers: { Authorization: `Bearer ${adminToken}` }, cache: "no-store" });
        if (!response.ok) throw new Error(`API 返回 ${response.status}`);
        const data = (await response.json()) as Telemetry;
        if (!stopped) {
          setTelemetry(data);
          setUpdatedAt(new Date().toLocaleTimeString());
          setError("");
        }
      } catch (cause) {
        if (!stopped) setError(cause instanceof Error ? cause.message : "遥测刷新失败");
      }
    };
    const timer = window.setInterval(refresh, 5000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [connected, apiUrl, adminToken]);

  async function createEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setInstallCommand("");
    try {
      if (!connected) throw new Error("请先连接控制 API。");
      const response = await fetch(`${apiUrl}/api/v1/enrollment-tokens`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
        body: "{}",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `API 返回 ${response.status}`);
      const command = [
        `curl -fsSL ${shellQuote(rawAgentUrl)} | sudo env`,
        `LINKPILOT_CONTROL_URL=${shellQuote(apiUrl)}`,
        `LINKPILOT_ENROLL_TOKEN=${shellQuote(payload.enrollmentToken)}`,
        `LINKPILOT_NAME=${shellQuote(serverName.trim())}`,
        `LINKPILOT_REGION=${shellQuote(region.trim())}`,
        `LINKPILOT_PROBE_ADDRESS=${shellQuote(probeAddress.trim())}`,
        `LINKPILOT_PROBE_PORT=${shellQuote(probePort)}`,
        `LINKPILOT_ACCESS_MODE=${shellQuote(accessMode)}`,
        "bash",
      ].join(" ");
      setInstallCommand(command);
      setShowEnrollment(true);
      onNotice(`一次性注册令牌已生成，有效期至 ${new Date(payload.expiresAt).toLocaleTimeString()}。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "生成安装命令失败");
    } finally {
      setBusy(false);
    }
  }

  async function removeNode(node: AgentNode) {
    if (!window.confirm(`移除 ${node.name} 的登记信息？该操作不会卸载远端 Agent。`)) return;
    try {
      const response = await fetch(`${apiUrl}/api/v1/agents/${node.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${adminToken}` } });
      if (!response.ok) throw new Error(`API 返回 ${response.status}`);
      await fetchTelemetry(apiUrl, adminToken);
      onNotice(`已移除 ${node.name} 的控制面登记；远端 Agent 需要手动卸载。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "移除节点失败");
    }
  }

  async function copyCommand() {
    await navigator.clipboard.writeText(installCommand);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  const nodes = telemetry?.nodes || [];
  const links = telemetry?.links || [];
  const onlineCount = nodes.filter((node) => node.status === "online").length;
  const averageLatency = links.length ? links.reduce((sum, link) => sum + link.latencyMs, 0) / links.length : null;
  const averageLoss = links.length ? links.reduce((sum, link) => sum + link.lossPercent, 0) / links.length : null;
  const detailNode = nodes.find((node) => node.id === selectedNode) || null;

  return (
    <section className="server-console">
      <div className="page-heading">
        <div><p className="eyebrow">FLEET / TELEMETRY / 05</p><h1>服务器接入</h1><p className="heading-sub">登记服务器 Agent，查看系统指标与节点间连通质量。</p></div>
        <div className="server-heading-actions"><span className={`status-label ${connected ? "sample" : "offline"}`}><i />{connected ? `API 已连接 · ${updatedAt || "等待数据"}` : "控制 API 未连接"}</span><button className="button button-dark" disabled={!connected} onClick={() => { setShowEnrollment(true); setInstallCommand(""); }}><Plus size={15} />添加服务器</button></div>
      </div>

      <section className="panel api-connection-panel">
        <div className="panel-heading"><div><h2>控制面连接</h2><p>在自托管控制服务与浏览器之间建立只读遥测连接。</p></div><span className="secure-label"><LockKeyhole size={14} />令牌仅保存在当前页面内存</span></div>
        <form className="api-connection-form" onSubmit={connectApi}>
          <label className="field"><span>控制 API 地址</span><input type="url" value={apiUrl} onChange={(event) => setApiUrl(event.target.value)} placeholder="https://control.example.com" required /></label>
          <label className="field"><span>管理员令牌</span><input type="password" value={adminToken} onChange={(event) => setAdminToken(event.target.value)} autoComplete="off" placeholder="从服务器 LINKPILOT_ADMIN_TOKEN 读取" required /></label>
          <button className="button button-primary" type="submit" disabled={busy || !adminToken.trim()}><Wifi size={15} />{busy ? "连接中" : connected ? "重新连接" : "连接"}</button>
          {connected && <button className="button button-quiet" type="button" onClick={() => { setConnected(false); setAdminToken(""); setTelemetry(null); }}><LockKeyhole size={14} />断开并清除令牌</button>}
        </form>
        <div className="server-security-note"><ShieldAlert size={15} /><span>远程 API 必须启用 HTTPS。GitHub Pages 是静态前端；控制 API 需单独部署并在 LINKPILOT_ALLOWED_ORIGINS 中允许当前站点来源。</span></div>
        {error && <p className="server-error" role="alert">{error}</p>}
      </section>

      <div className="metric-grid server-metrics" aria-label="实时服务器指标">
        <Metric label="在线 Agent" value={connected ? `${onlineCount} / ${nodes.length}` : "—"} detail={connected ? "30 秒心跳窗口" : "连接 API 后显示"} icon={<Server size={17} />} />
        <Metric label="节点间 TCP RTT" value={averageLatency === null ? "—" : `${averageLatency.toFixed(1)} ms`} detail={`${links.length} 条已探测链路`} icon={<Activity size={17} />} />
        <Metric label="TCP 探测失败率" value={averageLoss === null ? "—" : `${averageLoss.toFixed(1)}%`} detail="TCP connect 采样，不等同 ICMP 丢包" icon={<Cable size={17} />} />
        <Metric label="最近刷新" value={updatedAt || "—"} detail="每 5 秒轮询控制 API" icon={<RefreshCw size={17} />} />
      </div>

      <section className="panel node-panel live-node-panel">
        <div className="panel-heading"><div><h2>节点运行状态</h2><p>CPU、内存、磁盘、网卡吞吐、Agent 心跳</p></div><span className="draft-count">{nodes.length} 台已登记</span></div>
        <div className="table-scroll"><table><thead><tr><th>节点 / 接入端点</th><th>区域 / 通道</th><th>CPU</th><th>内存</th><th>磁盘</th><th>RX / TX</th><th>最近心跳</th><th>状态</th><th /></tr></thead>
          <tbody>{nodes.length ? nodes.map((node) => <tr key={node.id}>
            <td><div className="node-cell"><span className="node-icon"><Server size={15} /></span><span><strong>{node.name}</strong><small>{node.address}:{node.probePort}</small></span></div></td>
            <td>{node.region}<br /><span className="mono">{node.accessMode === "frp" ? "FRP 映射" : "直连探测"}</span></td>
            <td className="mono">{node.metrics ? `${node.metrics.cpuPercent.toFixed(1)}%` : "—"}</td>
            <td className="mono">{node.metrics ? `${node.metrics.memoryPercent.toFixed(1)}%` : "—"}</td>
            <td className="mono">{node.metrics ? `${node.metrics.diskPercent.toFixed(1)}%` : "—"}</td>
            <td className="mono">{node.metrics ? `${node.metrics.rxMbps.toFixed(2)} / ${node.metrics.txMbps.toFixed(2)} Mbps` : "—"}</td>
            <td>{elapsedLabel(node.ageMs)}</td>
            <td><span className={`status-label ${node.status === "online" ? "sample" : "offline"}`}><i />{node.status === "online" ? "在线" : "离线"}</span></td>
            <td className="node-row-actions"><button className="text-link" onClick={() => setSelectedNode(selectedNode === node.id ? null : node.id)}>{selectedNode === node.id ? "收起" : "详情"}</button><button className="remove-button" onClick={() => void removeNode(node)} title="移除登记，不卸载远端 Agent"><Trash2 size={14} /></button></td>
          </tr>) : <tr><td colSpan={9}><div className="table-empty"><Server size={19} /><strong>{connected ? "尚无已登记服务器" : "等待连接控制 API"}</strong><span>{connected ? "可生成一次性注册命令，把 Agent 安装到 Debian/Ubuntu 节点。" : "填写控制 API 地址与管理员令牌以读取真实遥测。"}</span></div></td></tr>}</tbody></table></div>
          {detailNode && <div className="node-detail-grid"><div><span>主机名</span><strong>{detailNode.system?.hostname || "等待 Agent 上报"}</strong></div><div><span>操作系统</span><strong>{detailNode.system?.os || "—"}</strong></div><div><span>内核 / 架构</span><strong>{detailNode.system ? `${detailNode.system.kernel} · ${detailNode.system.architecture}` : "—"}</strong></div><div><span>CPU</span><strong>{detailNode.system ? `${detailNode.system.cpuCount} 核 · ${detailNode.system.cpuModel}` : "—"}</strong></div><div><span>内存 / 磁盘容量</span><strong>{detailNode.system ? `${byteLabel(detailNode.system.memoryTotalBytes)} / ${byteLabel(detailNode.system.diskTotalBytes)}` : "—"}</strong></div><div><span>运行时间 / Agent</span><strong>{detailNode.metrics ? `${uptimeLabel(detailNode.metrics.uptimeSeconds)} · v${detailNode.agentVersion || "unknown"}` : "—"}</strong></div><div className="node-interfaces"><span>网卡名称（不含 IP/MAC）</span><strong>{detailNode.system?.interfaces.length ? detailNode.system.interfaces.join(" · ") : "等待 Agent 上报"}</strong></div></div>}
      </section>

      <section className="panel mesh-panel">
        <div className="panel-heading"><div><h2>节点互联探测</h2><p>Agent 对登记端点执行 3 次 TCP connect 探测，5 秒刷新</p></div><span className="secure-label"><Activity size={14} />只探测登记的 IP/端口</span></div>
        <div className="mesh-links">{links.length ? links.map((link) => {
          const source = nodes.find((node) => node.id === link.sourceId);
          const peer = nodes.find((node) => node.id === link.peerId);
          return <div className="mesh-link-row" key={`${link.sourceId}-${link.peerId}`}><span>{source?.name || link.sourceId}</span><span className="mesh-arrow">→</span><span>{peer?.name || link.peerId}</span><strong>{link.latencyMs.toFixed(1)} ms</strong><b className={link.lossPercent > 0 ? "loss-warning" : ""}>{link.lossPercent.toFixed(1)}% 失败</b><small>{new Date(link.checkedAt).toLocaleTimeString()}</small></div>;
        }) : <div className="table-empty mesh-empty"><Cable size={19} /><strong>尚无节点间探测结果</strong><span>至少登记两台服务器；FRP 模式请填写 frps 公网域名及分配给该节点的映射端口。</span></div>}</div>
        <div className="server-security-note"><ShieldAlert size={15} /><span>此处 RTT/失败率是 TCP 连通探测，不代表 ICMP 丢包，也不代表已建立 WireGuard/SD-WAN 隧道。系统不会扫描未登记网段。</span></div>
      </section>

      <section className="panel deployment-panel">
        <div className="panel-heading"><div><h2>部署方式</h2><p>控制 API 与 Agent 分开部署，支持境内外 Debian/Ubuntu Linux 节点。</p></div></div>
        <div className="deployment-grid">
          <article><strong><Globe2 size={16} />有公网 / 可出站</strong><p>在服务器填写对端可访问的公网域名/IP 和服务端口。Agent 主动发起 HTTPS 心跳，不要求节点开放 SSH 或入站管理端口。</p></article>
          <article><strong><Cable size={16} />无公网 / NAT</strong><p>Agent 控制链路由节点主动连接控制 API，通常不需要 FRP。跨节点探测如需入口，使用 FRPS 为每台节点分配独立映射端口，并填写映射地址。</p></article>
          <article><strong><LockKeyhole size={16} />自托管控制面</strong><p>设置 32 字节以上管理员令牌和 TLS 反向代理。控制面状态文件保存在 LINKPILOT_DATA_DIR，建议使用持久卷及防火墙限制管理来源。</p></article>
        </div>
      </section>

      {showEnrollment && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setShowEnrollment(false); setInstallCommand(""); } }}>
        <section className="panel enroll-modal" role="dialog" aria-modal="true" aria-labelledby="enroll-title">
          <div className="panel-heading"><div><h2 id="enroll-title">添加服务器 Agent</h2><p>生成 15 分钟有效、只能使用一次的注册命令。</p></div><button className="icon-button" onClick={() => { setShowEnrollment(false); setInstallCommand(""); }} aria-label="关闭">×</button></div>
          {!installCommand ? <form className="enroll-form" onSubmit={createEnrollment}>
            <label className="field"><span>服务器名称</span><input value={serverName} onChange={(event) => setServerName(event.target.value)} maxLength={120} placeholder="例如 edge-us-01" required /></label>
            <label className="field"><span>地区</span><input value={region} onChange={(event) => setRegion(event.target.value)} maxLength={80} placeholder="例如 US · Los Angeles" required /></label>
            <label className="field"><span>探测 IP / 域名</span><input value={probeAddress} onChange={(event) => setProbeAddress(event.target.value)} maxLength={253} placeholder="FRP 场景填 frps 公网地址" required /></label>
            <div className="enroll-inline"><label className="field"><span>探测端口</span><input type="number" min="1" max="65535" value={probePort} onChange={(event) => setProbePort(event.target.value)} required /></label><label className="field"><span>接入路径</span><select value={accessMode} onChange={(event) => setAccessMode(event.target.value as "direct" | "frp")}><option value="direct">直连 / 主动出站</option><option value="frp">FRP 映射端点</option></select></label></div>
            {error && <p className="server-error" role="alert">{error}</p>}
            <div className="editor-actions"><span><LockKeyhole size={14} />不上传 SSH 密码</span><button className="button button-primary" type="submit" disabled={!connected || busy}>{busy ? "生成中" : "生成安装命令"}<Plus size={14} /></button></div>
          </form> : <div className="install-result"><div className="server-security-note warning"><ShieldAlert size={15} /><span>命令包含单次注册令牌；仅粘贴到目标服务器终端，不要发给他人或提交到 Git。令牌 15 分钟后过期。</span></div><label className="field"><span>在目标 Debian/Ubuntu 服务器执行</span><textarea readOnly rows={7} value={installCommand} /></label><div className="editor-actions"><span>完成后服务名：linkpilot-agent</span><button className="button button-dark" onClick={() => void copyCommand()}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "已复制" : "复制命令"}</button></div></div>}
        </section>
      </div>}
    </section>
  );
}

function Metric({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: React.ReactNode }) {
  return <article className="metric-card server-metric-card"><div className="metric-top"><span>{label}</span>{icon}</div><div className="metric-value server-metric-value">{value}</div><div className="metric-foot"><i />{detail}</div></article>;
}
