"use client";

import { useState, type FormEvent } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  Bell,
  Check,
  ChevronDown,
  CircleHelp,
  Database,
  Gauge,
  Globe2,
  LockKeyhole,
  Network,
  Plus,
  Radio,
  Route,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Timer,
  Waypoints,
  Wifi,
} from "lucide-react";

type Section = "overview" | "routes" | "protocols" | "activity";
type RouteDraft = { id: number; match: string; action: string };

const navigation: { id: Section; label: string; icon: typeof Activity }[] = [
  { id: "overview", label: "总览", icon: Gauge },
  { id: "routes", label: "路由策略", icon: Route },
  { id: "protocols", label: "协议与网关", icon: Waypoints },
  { id: "activity", label: "操作记录", icon: Activity },
];

const protocolList = [
  { name: "Gost", category: "转发", detail: "TCP / UDP / TLS 隧道", tone: "mint" },
  { name: "Realm", category: "转发", detail: "TCP / UDP 端口中继", tone: "blue" },
  { name: "SD-WAN", category: "组网", detail: "多链路与站点互联", tone: "amber" },
  { name: "L2TP", category: "VPN", detail: "隧道接入", tone: "slate" },
  { name: "OpenVPN", category: "VPN", detail: "证书 / 用户认证", tone: "orange" },
  { name: "WireGuard", category: "VPN", detail: "密钥型隧道", tone: "lime" },
  { name: "IPsec / IKEv2", category: "VPN", detail: "站点到站点 / 移动接入", tone: "purple" },
];

const sampleNodes = [
  { name: "US · Edge-01", address: "198.51.100.10", role: "中转节点", protocol: "HY2 / VLESS", latency: "148 ms", loss: "0.2%", traffic: "42.8 Mbps" },
  { name: "TW · Taipei edge", address: "等待 Agent 注册", role: "出口网关", protocol: "WireGuard", latency: "31 ms", loss: "0.0%", traffic: "18.4 Mbps" },
  { name: "CN · Branch-01", address: "等待 Agent 注册", role: "SD-WAN 站点", protocol: "IKEv2", latency: "22 ms", loss: "0.1%", traffic: "8.2 Mbps" },
];

export default function Home() {
  const [section, setSection] = useState<Section>("overview");
  const [demoMode, setDemoMode] = useState(false);
  const [routeDrafts, setRouteDrafts] = useState<RouteDraft[]>([]);
  const [match, setMatch] = useState("");
  const [action, setAction] = useState("代理 · US-LA");
  const [notice, setNotice] = useState("");

  function addRoute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!match.trim()) return;
    setRouteDrafts((drafts) => [...drafts, { id: Date.now(), match: match.trim(), action }]);
    setNotice("规则已加入本页草稿，尚未下发到网关。");
    setMatch("");
  }

  function exportDraft() {
    const blob = new Blob([JSON.stringify({ version: 1, routes: routeDrafts }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "linkpilot-route-draft.json";
    link.click();
    URL.revokeObjectURL(url);
    setNotice("路由草稿已导出为 JSON；当前不会自动应用到设备。");
  }

  const metric = (value: string) => demoMode ? value : "—";

  return (
    <div className="console-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" onClick={() => setSection("overview")}>
          <span className="brand-mark"><Network size={19} strokeWidth={2.2} /></span>
          <span><strong>linkpilot</strong><small>NETWORK CONTROL</small></span>
        </a>

        <div className="workspace-switch">
          <span className="workspace-icon">N</span>
          <span className="workspace-copy"><strong>Northstar Lab</strong><small>个人工作区</small></span>
          <ChevronDown size={15} />
        </div>

        <p className="nav-caption">工作台</p>
        <nav className="primary-nav" aria-label="主导航">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav-item ${section === id ? "is-active" : ""}`} onClick={() => setSection(id)}>
              <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
              {id === "routes" && routeDrafts.length > 0 && <span className="nav-count">{routeDrafts.length}</span>}
            </button>
          ))}
        </nav>

        <p className="nav-caption nav-caption-spaced">资源</p>
        <button className="nav-item" onClick={() => setNotice("Agent 尚未接入；目前没有可管理的真实网关。")}><Server size={17} /><span>网关与节点</span></button>
        <button className="nav-item" onClick={() => setNotice("监控数据需要 Agent 上报后才会显示。") }><Activity size={17} /><span>链路监控</span></button>
        <button className="nav-item" onClick={() => setNotice("DNS 配置通道尚未接入 Agent。") }><Globe2 size={17} /><span>DNS 与解析</span></button>

        <div className="sidebar-bottom">
          <div className="agent-mini"><span className="status-dot offline" /><span><strong>控制面</strong><small>Agent 未连接</small></span><span className="agent-pill">离线</span></div>
          <button className="nav-item" onClick={() => setNotice("设置界面将在接入认证与 Agent 管理 API 后开放。")}><Settings2 size={17} /><span>设置</span></button>
          <div className="user-row"><span className="avatar">NO</span><span><strong>Network Ops</strong><small>管理员</small></span><CircleHelp size={16} className="muted-icon" /></div>
        </div>
      </aside>

      <main className="main-area" id="overview">
        <header className="topbar">
          <div className="crumb"><span>Northstar Lab</span><span className="crumb-sep">/</span><strong>{navigation.find((item) => item.id === section)?.label}</strong></div>
          <div className="top-actions">
            <label className={`demo-toggle ${demoMode ? "enabled" : ""}`}>
              <input type="checkbox" checked={demoMode} onChange={(event) => setDemoMode(event.target.checked)} />
              <span className="toggle-track" /><span>演示数据</span>
            </label>
            <button className="icon-button" aria-label="搜索" onClick={() => setNotice("搜索将在后端 API 接入后启用。")}><Search size={17} /></button>
            <button className="icon-button notification-button" aria-label="通知" onClick={() => setNotice("暂无通知。接入 Agent 后会显示节点告警。")}><Bell size={17} /><i /></button>
            <span className="top-avatar">DL</span>
          </div>
        </header>

        <div className="content-wrap">
          {demoMode && <div className="demo-banner"><Radio size={15} />演示数据已开启，仅用于界面预览，不代表真实节点或线路状态。</div>}
          {!demoMode && <div className="notice-banner"><span className="status-dot offline" />尚未连接网络 Agent · 当前不会读取或更改任何服务器配置</div>}

          {section === "overview" && (
            <>
              <div className="page-heading">
                <div><p className="eyebrow">NETWORK OPERATIONS / 01</p><h1>网络总览</h1><p className="heading-sub">查看节点、链路和流量状态。</p></div>
                <button className="button button-dark" onClick={() => setNotice("Agent 注册服务尚未部署；目前不能接收节点。") }><Plus size={16} />添加 Agent</button>
              </div>

              <section className="metric-grid" aria-label="网络指标">
                <MetricCard icon={Server} label="在线节点" value={demoMode ? "3" : "0"} unit="/ 3 已登记" foot={demoMode ? "演示状态" : "等待 Agent 注册"} accent="mint" />
                <MetricCard icon={Timer} label="端到端延迟" value={metric("148")} unit={demoMode ? "ms" : ""} foot={demoMode ? "近 5 分钟均值" : "无遥测数据"} accent="blue" />
                <MetricCard icon={Activity} label="丢包率" value={metric("0.2")} unit={demoMode ? "%" : ""} foot={demoMode ? "近 5 分钟均值" : "无遥测数据"} accent="amber" />
                <MetricCard icon={ArrowDownToLine} label="实时吞吐" value={metric("42.8")} unit={demoMode ? "Mbps" : ""} foot={demoMode ? "↓ 30.1 / ↑ 12.7 Mbps" : "无遥测数据"} accent="coral" />
              </section>

              <section className="panel node-panel">
                <div className="panel-heading"><div><h2>节点与网关</h2><p>登记设备与当前链路状态</p></div><button className="button button-quiet" onClick={() => setNotice("没有已接入的 Agent，暂时没有可刷新的运行状态。")}><Activity size={15} />刷新状态</button></div>
                <div className="table-scroll"><table><thead><tr><th>节点</th><th>角色</th><th>协议</th><th>延迟</th><th>丢包</th><th>吞吐</th><th>状态</th></tr></thead>
                  <tbody>{sampleNodes.map((node) => <tr key={node.name}>
                    <td><div className="node-cell"><span className="node-icon"><Server size={16} /></span><span><strong>{node.name}</strong><small>{node.address}</small></span></div></td>
                    <td>{node.role}</td><td><span className="protocol-chip">{node.protocol}</span></td>
                    <td className="mono">{demoMode ? node.latency : "—"}</td><td className="mono">{demoMode ? node.loss : "—"}</td><td className="mono">{demoMode ? node.traffic : "—"}</td>
                    <td><span className={`status-label ${demoMode ? "sample" : "offline"}`}><i />{demoMode ? "演示" : "未接入"}</span></td>
                  </tr>)}</tbody></table></div>
                <div className="panel-footer"><span>显示 3 个登记槽位</span><span className="footer-hint"><LockKeyhole size={13} />配置变更需通过受认证 Agent 执行</span></div>
              </section>

              <div className="lower-grid">
                <section className="panel signal-panel"><div className="panel-heading"><div><h2>链路质量</h2><p>端到端探测 · 最近 60 分钟</p></div><button className="period-select" onClick={() => setNotice("监控时间范围将在遥测 API 接入后开放。")}>1 小时 <ChevronDown size={14} /></button></div>
                  {demoMode ? <div className="chart-area"><div className="chart-y"><span>200</span><span>150</span><span>100</span><span>50</span></div><div className="chart-plot"><div className="chart-gridlines"><i /><i /><i /><i /></div><svg viewBox="0 0 640 180" preserveAspectRatio="none" role="img" aria-label="演示延迟曲线"><path d="M0 126 C26 119 29 75 56 86 S91 147 119 121 S151 103 174 109 S206 54 232 79 S267 131 291 113 S327 89 348 100 S381 53 405 72 S441 116 460 96 S491 60 519 78 S548 125 572 101 S612 83 640 72" fill="none" stroke="#147d68" strokeWidth="3" vectorEffect="non-scaling-stroke" /><path d="M0 126 C26 119 29 75 56 86 S91 147 119 121 S151 103 174 109 S206 54 232 79 S267 131 291 113 S327 89 348 100 S381 53 405 72 S441 116 460 96 S491 60 519 78 S548 125 572 101 S612 83 640 72 L640 180 L0 180Z" fill="url(#areaFill)" opacity=".3" /><defs><linearGradient id="areaFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#66c5a8" /><stop offset="1" stopColor="#fff" /></linearGradient></defs></svg><div className="chart-x"><span>10:00</span><span>10:15</span><span>10:30</span><span>10:45</span><span>11:00</span></div></div></div> : <div className="empty-chart"><span className="empty-chart-icon"><Activity size={20} /></span><strong>等待链路遥测</strong><span>接入 Agent 后显示延迟、抖动与丢包趋势</span></div>}
                  <div className="chart-legend"><span><i className="legend-line" />端到端延迟</span><span><i className="legend-dash" />丢包事件</span></div>
                </section>
                <section className="panel route-summary"><div className="panel-heading"><div><h2>路由策略</h2><p>规则草稿与执行状态</p></div><button className="text-link" onClick={() => setSection("routes")}>管理规则 <ArrowUpRight size={14} /></button></div>
                  <div className="route-summary-main"><div className="summary-ring"><Route size={20} /><strong>{routeDrafts.length}</strong><small>条草稿</small></div><div><span className="draft-state">未下发</span><p>规则仅保存在当前页面内存中。</p></div></div>
                  <div className="route-bottom"><span><ShieldCheck size={15} />变更保护</span><strong>Agent 未连接</strong></div>
                </section>
              </div>
            </>
          )}

          {section === "routes" && (
            <>
              <div className="page-heading"><div><p className="eyebrow">POLICY ENGINE / 02</p><h1>路由策略</h1><p className="heading-sub">创建本地规则草稿；接入网关 Agent 前不会下发。</p></div><button className="button button-quiet" onClick={exportDraft} disabled={!routeDrafts.length}><ArrowDownToLine size={16} />导出 JSON</button></div>
              <div className="route-warning"><ShieldCheck size={17} /><div><strong>安全预览模式</strong><span>此版本没有设备控制 API。保存只会更新本页内存，离开页面后草稿清空。</span></div></div>
              <section className="panel editor-panel"><div className="panel-heading"><div><h2>添加分流规则</h2><p>按域名或网段匹配，再选择出口动作</p></div><span className="draft-count">{routeDrafts.length} 条草稿</span></div>
                <form className="route-form" onSubmit={addRoute}><label className="field"><span>匹配对象</span><input value={match} onChange={(event) => setMatch(event.target.value)} placeholder="域名 / CIDR，例如 video.example.com" /></label><label className="field"><span>流量动作</span><select value={action} onChange={(event) => setAction(event.target.value)}><option>代理 · US-LA</option><option>代理 · TW-TPE</option><option>直连 · DIRECT</option><option>阻断 · REJECT</option></select></label><button className="button button-dark" type="submit" disabled={!match.trim()}><Plus size={16} />加入草稿</button></form>
                <div className="rules-table-wrap"><table><thead><tr><th>优先级</th><th>匹配条件</th><th>动作</th><th>状态</th><th aria-label="操作" /></tr></thead><tbody>{routeDrafts.length ? routeDrafts.map((rule, index) => <tr key={rule.id}><td className="mono">{String(index + 1).padStart(2, "0")}</td><td className="rule-match">{rule.match}</td><td><span className="action-chip">{rule.action}</span></td><td><span className="status-label draft"><i />草稿</span></td><td><button className="remove-button" aria-label={`删除 ${rule.match}`} onClick={() => setRouteDrafts((drafts) => drafts.filter((item) => item.id !== rule.id))}>移除</button></td></tr>) : <tr><td colSpan={5}><div className="table-empty"><Route size={19} /><strong>还没有路由草稿</strong><span>添加规则后可导出为 JSON。</span></div></td></tr>}</tbody></table></div>
                <div className="editor-actions"><span><LockKeyhole size={14} />应用到设备：Agent 未连接</span><button className="button button-primary" disabled><Check size={15} />应用变更</button></div>
              </section>
              {notice && <div className="inline-notice" role="status">{notice}</div>}
            </>
          )}

          {section === "protocols" && (
            <>
              <div className="page-heading"><div><p className="eyebrow">CONNECTIVITY / 03</p><h1>协议与网关</h1><p className="heading-sub">协议能力目录；状态表示面板集成进度，不表示运行中服务。</p></div><span className="status-label offline"><i />0 个 Agent 在线</span></div>
              <div className="protocol-grid">{protocolList.map((protocol) => <article className="protocol-card" key={protocol.name}><div className="protocol-card-top"><span className={`protocol-icon ${protocol.tone}`}><Waypoints size={17} /></span><span className="category-tag">{protocol.category}</span></div><h2>{protocol.name}</h2><p>{protocol.detail}</p><div className="protocol-card-bottom"><span><i className="status-dot offline" />未接入</span><button aria-label={`查看 ${protocol.name} 接入状态`} onClick={() => setNotice(`${protocol.name} 需要服务端 Agent / Adapter；当前只有目录项。`)}><ArrowUpRight size={15} /></button></div></article>)}</div>
              <section className="panel integration-panel"><div className="integration-icon"><Database size={19} /></div><div><h2>接入执行 Agent</h2><p>协议启停、网关配置、WireGuard/IPsec 密钥、路由下发与监控采集，都需要部署在受控设备上的 Agent 和认证 API。本原型不保存私钥，也不直接运行系统命令。</p></div><button className="button button-quiet" onClick={() => setNotice("Agent 协议与 API 规范尚未实现；当前操作不会更改服务器。")}>查看接入状态 <ArrowUpRight size={14} /></button></section>
            </>
          )}

          {section === "activity" && (
            <>
              <div className="page-heading"><div><p className="eyebrow">AUDIT TRAIL / 04</p><h1>操作记录</h1><p className="heading-sub">正式审计日志需要后端身份验证与数据库；目前没有服务端日志。</p></div><span className="status-label offline"><i />未接入</span></div>
              <section className="panel empty-audit"><div className="audit-mark"><Activity size={22} /></div><h2>暂无审计记录</h2><p>页面内的草稿操作不会持久化，也不作为安全审计记录。</p><button className="button button-quiet" onClick={() => setSection("routes")}><SlidersHorizontal size={15} />前往路由策略</button></section>
            </>
          )}

          <footer className="app-footer"><span>LINKPILOT <b>CONTROL PLANE</b></span><span><Wifi size={13} />面板预览 · 未连接设备</span><span>v0.1.0</span></footer>
        </div>
      </main>
      {notice && <div className="toast" role="status"><span className="toast-check"><Check size={14} /></span>{notice}<button aria-label="关闭提示" onClick={() => setNotice("")}>×</button></div>}
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, unit, foot, accent }: { icon: typeof Activity; label: string; value: string; unit: string; foot: string; accent: string }) {
  return <article className={`metric-card ${accent}`}><div className="metric-top"><span>{label}</span><Icon size={17} /></div><div className="metric-value">{value}<small>{unit}</small></div><div className="metric-foot"><i />{foot}</div></article>;
}
