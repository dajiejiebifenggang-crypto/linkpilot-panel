#!/usr/bin/env node
import { createConnection, isIP } from "node:net";
import { arch, cpus, hostname, networkInterfaces, platform, release, totalmem } from "node:os";
import { mkdir, readFile, statfs, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const VERSION = "0.2.0";
const configPath = resolve(process.env.LINKPILOT_AGENT_CONFIG || "/etc/linkpilot/agent.json");
const controlUrl = (process.env.LINKPILOT_CONTROL_URL || "").replace(/\/+$/, "");
const args = process.argv.slice(2);
const mode = args[0] || "run";
let previousCpu;
let previousNetwork;

function requireValue(value, name) {
  if (!value || !String(value).trim()) throw new Error(`${name} is required`);
  return String(value).trim();
}

function isValidHost(value) {
  if (typeof value !== "string" || value.length > 253 || /[\s/\\]/.test(value)) return false;
  if (isIP(value)) return true;
  return value.split(".").every((part) => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(part));
}

async function requestJson(url, { method = "GET", token, body } = {}) {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

async function enroll() {
  const endpoint = requireValue(controlUrl, "LINKPILOT_CONTROL_URL");
  const parsedControlUrl = new URL(endpoint);
  const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(parsedControlUrl.hostname);
  if (parsedControlUrl.protocol !== "https:" && !(parsedControlUrl.protocol === "http:" && localHost)) {
    throw new Error("LINKPILOT_CONTROL_URL must use HTTPS except for localhost development");
  }
  const enrollmentToken = requireValue(process.env.LINKPILOT_ENROLL_TOKEN, "LINKPILOT_ENROLL_TOKEN");
  const name = requireValue(process.env.LINKPILOT_NAME || hostname(), "LINKPILOT_NAME");
  const region = requireValue(process.env.LINKPILOT_REGION, "LINKPILOT_REGION");
  const probeAddress = requireValue(process.env.LINKPILOT_PROBE_ADDRESS, "LINKPILOT_PROBE_ADDRESS");
  const probePort = Number(process.env.LINKPILOT_PROBE_PORT || 443);
  const accessMode = process.env.LINKPILOT_ACCESS_MODE || "direct";
  if (!isValidHost(probeAddress)) throw new Error("LINKPILOT_PROBE_ADDRESS must be an IP address or DNS host without port");
  if (!Number.isInteger(probePort) || probePort < 1 || probePort > 65535) throw new Error("LINKPILOT_PROBE_PORT must be 1..65535");
  if (!["direct", "frp"].includes(accessMode)) throw new Error("LINKPILOT_ACCESS_MODE must be direct or frp");

  const result = await requestJson(`${endpoint}/api/v1/agents/enroll`, {
    method: "POST",
    body: { enrollmentToken, name, region, probeAddress, probePort, accessMode },
  });
  const config = {
    controlUrl: endpoint,
    nodeId: result.id,
    nodeToken: result.agentToken,
    name,
    region,
    probeAddress,
    probePort,
    accessMode,
  };
  await mkdir(dirname(configPath), { recursive: true, mode: 0o750 });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  console.log(`Agent registered as ${name} (${result.id}). Credential saved with mode 0600 at ${configPath}.`);
  if (args.includes("--install-service")) await installService();
}

async function installService() {
  if (process.platform !== "linux") throw new Error("systemd installation is supported on Linux only");
  if (typeof process.getuid === "function" && process.getuid() !== 0) throw new Error("run enrollment with sudo to install a system service");
  const userCheck = spawnSync("id", ["-u", "linkpilot"], { stdio: "ignore" });
  if (userCheck.status !== 0) {
    const created = spawnSync("useradd", ["--system", "--home-dir", "/var/lib/linkpilot", "--shell", "/usr/sbin/nologin", "linkpilot"], { stdio: "inherit" });
    if (created.error || created.status !== 0) throw created.error || new Error("could not create linkpilot system user");
  }
  const directoryOwner = spawnSync("chown", ["root:linkpilot", dirname(configPath)], { stdio: "inherit" });
  const directoryPermissions = spawnSync("chmod", ["0750", dirname(configPath)], { stdio: "inherit" });
  const owner = spawnSync("chown", [`root:linkpilot`, configPath], { stdio: "inherit" });
  const permissions = spawnSync("chmod", ["0640", configPath], { stdio: "inherit" });
  if (directoryOwner.error || directoryPermissions.error || owner.error || permissions.error || directoryOwner.status !== 0 || directoryPermissions.status !== 0 || owner.status !== 0 || permissions.status !== 0) {
    throw directoryOwner.error || directoryPermissions.error || owner.error || permissions.error || new Error("could not secure agent config permissions");
  }
  const unit = `[Unit]\nDescription=LinkPilot read-only network telemetry agent\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nUser=linkpilot\nGroup=linkpilot\nEnvironment=LINKPILOT_AGENT_CONFIG=${configPath}\nExecStart=${process.execPath} ${resolve(process.argv[1])} run\nRestart=always\nRestartSec=5\nNoNewPrivileges=true\nProtectSystem=strict\nProtectHome=true\nPrivateTmp=true\nReadOnlyPaths=/proc /sys\n\n[Install]\nWantedBy=multi-user.target\n`;
  const unitPath = "/etc/systemd/system/linkpilot-agent.service";
  await writeFile(unitPath, unit, { mode: 0o644 });
  const reload = spawnSync("systemctl", ["daemon-reload"], { stdio: "inherit" });
  const enable = spawnSync("systemctl", ["enable", "--now", "linkpilot-agent.service"], { stdio: "inherit" });
  if (reload.error || enable.error) throw reload.error || enable.error;
  if (reload.status !== 0 || enable.status !== 0) throw new Error("systemd setup failed");
  console.log("systemd service enabled: linkpilot-agent.service");
}

async function cpuPercent() {
  const text = await readFile("/proc/stat", "utf8");
  const values = text.split("\n", 1)[0].trim().split(/\s+/).slice(1).map(Number);
  const idle = values[3] + (values[4] || 0);
  const total = values.reduce((sum, value) => sum + value, 0);
  const current = { idle, total };
  if (!previousCpu) {
    previousCpu = current;
    return 0;
  }
  const idleDelta = idle - previousCpu.idle;
  const totalDelta = total - previousCpu.total;
  previousCpu = current;
  return totalDelta > 0 ? Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100)) : 0;
}

async function memoryPercent() {
  const text = await readFile("/proc/meminfo", "utf8");
  const values = Object.fromEntries([...text.matchAll(/^(MemTotal|MemAvailable):\s+(\d+)\s+kB/gm)].map((match) => [match[1], Number(match[2])]));
  if (!values.MemTotal) return 0;
  return Math.max(0, Math.min(100, ((values.MemTotal - (values.MemAvailable || 0)) / values.MemTotal) * 100));
}

async function networkRates() {
  const text = await readFile("/proc/net/dev", "utf8");
  let rxBytes = 0;
  let txBytes = 0;
  for (const line of text.split("\n").slice(2)) {
    const [name, counters] = line.trim().split(":");
    if (!counters || name === "lo") continue;
    const values = counters.trim().split(/\s+/).map(Number);
    rxBytes += values[0] || 0;
    txBytes += values[8] || 0;
  }
  const now = Date.now();
  let rxMbps = 0;
  let txMbps = 0;
  if (previousNetwork) {
    const seconds = (now - previousNetwork.at) / 1000;
    if (seconds > 0) {
      rxMbps = Math.max(0, ((rxBytes - previousNetwork.rxBytes) * 8) / seconds / 1_000_000);
      txMbps = Math.max(0, ((txBytes - previousNetwork.txBytes) * 8) / seconds / 1_000_000);
    }
  }
  previousNetwork = { at: now, rxBytes, txBytes };
  return { rxBytes, txBytes, rxMbps, txMbps };
}

async function systemInfo(diskTotalBytes) {
  const osRelease = await readFile("/etc/os-release", "utf8").catch(() => "");
  const prettyName = osRelease.match(/^PRETTY_NAME="?([^"\n]+)"?/m)?.[1] || `${platform()} ${release()}`;
  const interfaces = Object.entries(networkInterfaces())
    .filter(([name, addresses]) => name !== "lo" && addresses?.some((address) => !address.internal))
    .map(([name]) => name)
    .slice(0, 16);
  return {
    hostname: hostname().slice(0, 120),
    os: prettyName.slice(0, 120),
    platform: platform().slice(0, 40),
    kernel: release().slice(0, 80),
    architecture: arch().slice(0, 40),
    cpuCount: cpus().length,
    cpuModel: (cpus()[0]?.model || "unknown").slice(0, 120),
    memoryTotalBytes: totalmem(),
    diskTotalBytes,
    interfaces,
  };
}

async function metrics() {
  const disk = await statfs("/");
  const diskTotal = disk.blocks * disk.bsize;
  const diskFree = disk.bavail * disk.bsize;
  const net = await networkRates();
  const uptime = Number((await readFile("/proc/uptime", "utf8")).split(" ", 1)[0]);
  return {
    agentVersion: VERSION,
    cpuPercent: await cpuPercent(),
    memoryPercent: await memoryPercent(),
    diskPercent: diskTotal > 0 ? Math.max(0, Math.min(100, ((diskTotal - diskFree) / diskTotal) * 100)) : 0,
    diskTotalBytes: diskTotal,
    uptimeSeconds: Number.isFinite(uptime) ? uptime : 0,
    system: await systemInfo(diskTotal),
    ...net,
  };
}

function tcpProbe(host, port, timeoutMs = 2200) {
  return new Promise((resolveProbe) => {
    const started = performance.now();
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveProbe({ ok, latencyMs: ok ? performance.now() - started : null });
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function probePeers(config) {
  const peersResponse = await requestJson(`${config.controlUrl}/api/v1/agents/peers`, { token: config.nodeToken });
  const results = [];
  for (const peer of peersResponse.peers.slice(0, 32)) {
    const attempts = await Promise.all(Array.from({ length: 3 }, () => tcpProbe(peer.address, peer.probePort)));
    const successes = attempts.filter((attempt) => attempt.ok);
    const average = successes.length ? successes.reduce((sum, item) => sum + item.latencyMs, 0) / successes.length : 120_000;
    results.push({ peerId: peer.id, latencyMs: Number(average.toFixed(2)), lossPercent: Number(((3 - successes.length) / 3 * 100).toFixed(1)), samples: 3 });
  }
  if (results.length) await requestJson(`${config.controlUrl}/api/v1/agents/probes`, { method: "POST", token: config.nodeToken, body: { results } });
}

async function run() {
  if (process.platform !== "linux") throw new Error("The telemetry agent currently supports Linux only");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  if (!config.controlUrl || !config.nodeToken || !config.nodeId) throw new Error(`invalid agent config: ${configPath}`);
  console.log(`LinkPilot Agent ${VERSION} started for ${config.name}; read-only telemetry mode.`);
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const sample = await metrics();
      await requestJson(`${config.controlUrl}/api/v1/agents/heartbeat`, { method: "POST", token: config.nodeToken, body: sample });
      await probePeers(config);
    } catch (error) {
      console.error(`telemetry failed: ${error.message}`);
    } finally {
      busy = false;
    }
  };
  await tick();
  setInterval(tick, 10_000);
}

try {
  if (mode === "enroll") await enroll();
  else if (mode === "run") await run();
  else throw new Error("usage: node agent.mjs enroll [--install-service] | run");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
