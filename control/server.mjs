import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const port = Number(process.env.LINKPILOT_PORT || 8787);
const host = process.env.LINKPILOT_HOST || "127.0.0.1";
const adminToken = process.env.LINKPILOT_ADMIN_TOKEN || "";
const allowedOrigins = new Set(
  (process.env.LINKPILOT_ALLOWED_ORIGINS || "http://localhost:3000,http://127.0.0.1:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
const dataDirectory = path.resolve(process.env.LINKPILOT_DATA_DIR || "./data");
const stateFile = path.join(dataDirectory, "state.json");
const maxBodyBytes = 64 * 1024;
const maxHistory = 360;
let state = { nodes: [], enrollmentTokens: [], links: [] };
let writeQueue = Promise.resolve();
const enrollmentAttempts = new Map();

const hash = (value) => createHash("sha256").update(value).digest("hex");

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function bearerToken(request) {
  const value = request.headers.authorization || "";
  const match = /^Bearer ([A-Za-z0-9._~-]{24,256})$/.exec(value);
  return match?.[1] || "";
}

function respond(response, status, data) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(data));
}

async function bodyJson(request) {
  let length = 0;
  const chunks = [];
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maxBodyBytes) throw Object.assign(new Error("请求体过大"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("JSON 格式错误"), { status: 400 });
  }
}

function validString(value, max = 120) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function finiteNumber(value, min = 0, max = 1e12) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

async function persist() {
  writeQueue = writeQueue.then(async () => {
    await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
    const temporary = `${stateFile}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
    await rename(temporary, stateFile);
  });
  return writeQueue;
}

async function load() {
  try {
    state = JSON.parse(await readFile(stateFile, "utf8"));
    if (!Array.isArray(state.nodes) || !Array.isArray(state.enrollmentTokens) || !Array.isArray(state.links)) {
      throw new Error("state schema mismatch");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await persist();
  }
}

function findNodeToken(token) {
  const tokenHash = hash(token);
  return state.nodes.find((node) => safeEqual(node.tokenHash, tokenHash));
}

function adminAuthorized(request) {
  const token = bearerToken(request);
  return adminToken.length >= 32 && Boolean(token) && safeEqual(token, adminToken);
}

function nodeAuthorized(request) {
  const token = bearerToken(request);
  return token ? findNodeToken(token) : undefined;
}

function publicNode(node, now = Date.now()) {
  const ageMs = node.lastSeen ? now - node.lastSeen : null;
  return {
    id: node.id,
    name: node.name,
    region: node.region,
    address: node.address,
    probePort: node.probePort,
    accessMode: node.accessMode,
    agentVersion: node.agentVersion,
    createdAt: node.createdAt,
    lastSeen: node.lastSeen,
    ageMs,
    status: ageMs !== null && ageMs < 30_000 ? "online" : "offline",
    system: node.system,
    metrics: node.metrics,
    history: node.history,
  };
}

function rateAllowed(request) {
  const now = Date.now();
  const key = request.socket.remoteAddress || "unknown";
  const old = enrollmentAttempts.get(key) || { count: 0, start: now };
  if (now - old.start > 60_000) {
    enrollmentAttempts.set(key, { count: 1, start: now });
    return true;
  }
  old.count += 1;
  enrollmentAttempts.set(key, old);
  return old.count <= 12;
}

function setCors(request, response) {
  const origin = request.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  }
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
}

async function handle(request, response) {
  setCors(request, response);
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const route = `${request.method} ${url.pathname}`;

  if (route === "GET /api/v1/health") {
    respond(response, 200, { ok: true, service: "linkpilot-control", version: "0.2.0", time: new Date().toISOString() });
    return;
  }

  if (route === "POST /api/v1/agents/enroll") {
    if (!rateAllowed(request)) {
      respond(response, 429, { error: "注册请求过于频繁" });
      return;
    }
    const payload = await bodyJson(request);
    const enrollHash = typeof payload.enrollmentToken === "string" ? hash(payload.enrollmentToken) : "";
    const tokenIndex = state.enrollmentTokens.findIndex((entry) => entry.expiresAt > Date.now() && safeEqual(entry.tokenHash, enrollHash));
    if (tokenIndex < 0) {
      respond(response, 401, { error: "注册令牌无效或已过期" });
      return;
    }
    if (!validString(payload.name) || !validString(payload.region, 80) || !validString(payload.probeAddress, 253)) {
      respond(response, 400, { error: "name、region 和 probeAddress 均为必填项" });
      return;
    }
    if (!Number.isInteger(payload.probePort) || payload.probePort < 1 || payload.probePort > 65535) {
      respond(response, 400, { error: "probePort 必须在 1 到 65535 之间" });
      return;
    }
    if (!["direct", "frp"].includes(payload.accessMode)) {
      respond(response, 400, { error: "accessMode 只能是 direct 或 frp" });
      return;
    }

    const agentToken = randomBytes(32).toString("base64url");
    const node = {
      id: randomBytes(12).toString("hex"),
      tokenHash: hash(agentToken),
      name: payload.name.trim(),
      region: payload.region.trim(),
      address: payload.probeAddress.trim(),
      probePort: payload.probePort,
      accessMode: payload.accessMode,
      createdAt: Date.now(),
      lastSeen: null,
      metrics: null,
      history: [],
    };
    state.enrollmentTokens.splice(tokenIndex, 1);
    state.nodes.push(node);
    await persist();
    respond(response, 201, { id: node.id, agentToken, heartbeatSeconds: 10 });
    return;
  }

  if (route === "POST /api/v1/enrollment-tokens") {
    if (!adminAuthorized(request)) {
      respond(response, adminToken ? 401 : 503, { error: adminToken ? "管理员令牌无效" : "LINKPILOT_ADMIN_TOKEN 未配置" });
      return;
    }
    const token = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + 15 * 60_000;
    state.enrollmentTokens = state.enrollmentTokens.filter((entry) => entry.expiresAt > Date.now());
    state.enrollmentTokens.push({ tokenHash: hash(token), expiresAt });
    await persist();
    respond(response, 201, { enrollmentToken: token, expiresAt: new Date(expiresAt).toISOString(), uses: 1 });
    return;
  }

  if (route === "GET /api/v1/telemetry") {
    if (!adminAuthorized(request)) {
      respond(response, adminToken ? 401 : 503, { error: adminToken ? "需要管理员令牌" : "LINKPILOT_ADMIN_TOKEN 未配置" });
      return;
    }
    const now = Date.now();
    const nodes = state.nodes.map((node) => publicNode(node, now));
    respond(response, 200, { generatedAt: new Date(now).toISOString(), nodes, links: state.links });
    return;
  }

  if (route === "GET /api/v1/agents/peers") {
    const current = nodeAuthorized(request);
    if (!current) {
      respond(response, 401, { error: "Agent 令牌无效" });
      return;
    }
    respond(response, 200, {
      peers: state.nodes.filter((node) => node.id !== current.id).map(({ id, name, region, address, probePort }) => ({ id, name, region, address, probePort })),
    });
    return;
  }

  if (route === "POST /api/v1/agents/heartbeat") {
    const current = nodeAuthorized(request);
    if (!current) {
      respond(response, 401, { error: "Agent 令牌无效" });
      return;
    }
    const payload = await bodyJson(request);
    const required = ["cpuPercent", "memoryPercent", "diskPercent", "uptimeSeconds", "rxBytes", "txBytes"];
    if (!required.every((key) => finiteNumber(payload[key], 0, key.endsWith("Percent") ? 100 : Number.MAX_SAFE_INTEGER))) {
      respond(response, 400, { error: "系统指标字段无效" });
      return;
    }
    const now = Date.now();
    current.lastSeen = now;
    current.agentVersion = validString(payload.agentVersion, 40) ? payload.agentVersion : "unknown";
    current.metrics = {
      cpuPercent: payload.cpuPercent,
      memoryPercent: payload.memoryPercent,
      diskPercent: payload.diskPercent,
      uptimeSeconds: payload.uptimeSeconds,
      rxBytes: payload.rxBytes,
      txBytes: payload.txBytes,
      rxMbps: finiteNumber(payload.rxMbps) ? payload.rxMbps : 0,
      txMbps: finiteNumber(payload.txMbps) ? payload.txMbps : 0,
      sampledAt: now,
    };
    const system = payload.system && typeof payload.system === "object" ? payload.system : {};
    current.system = {
      hostname: validString(system.hostname, 120) ? system.hostname : "unknown",
      os: validString(system.os, 120) ? system.os : "unknown",
      platform: validString(system.platform, 40) ? system.platform : "unknown",
      kernel: validString(system.kernel, 80) ? system.kernel : "unknown",
      architecture: validString(system.architecture, 40) ? system.architecture : "unknown",
      cpuCount: Number.isInteger(system.cpuCount) && system.cpuCount > 0 && system.cpuCount <= 256 ? system.cpuCount : 0,
      cpuModel: validString(system.cpuModel, 120) ? system.cpuModel : "unknown",
      memoryTotalBytes: finiteNumber(system.memoryTotalBytes, 0, Number.MAX_SAFE_INTEGER) ? system.memoryTotalBytes : 0,
      diskTotalBytes: finiteNumber(payload.diskTotalBytes, 0, Number.MAX_SAFE_INTEGER) ? payload.diskTotalBytes : 0,
      interfaces: Array.isArray(system.interfaces) ? system.interfaces.filter((name) => validString(name, 32)).slice(0, 16) : [],
    };
    current.history.push({ at: now, cpuPercent: current.metrics.cpuPercent, memoryPercent: current.metrics.memoryPercent, rxMbps: current.metrics.rxMbps, txMbps: current.metrics.txMbps });
    if (current.history.length > maxHistory) current.history.splice(0, current.history.length - maxHistory);
    await persist();
    respond(response, 202, { accepted: true, peerCount: Math.max(0, state.nodes.length - 1) });
    return;
  }

  if (route === "POST /api/v1/agents/probes") {
    const current = nodeAuthorized(request);
    if (!current) {
      respond(response, 401, { error: "Agent 令牌无效" });
      return;
    }
    const payload = await bodyJson(request);
    if (!Array.isArray(payload.results) || payload.results.length > 32) {
      respond(response, 400, { error: "results 必须是最多 32 项的数组" });
      return;
    }
    const now = Date.now();
    const validIds = new Set(state.nodes.filter((node) => node.id !== current.id).map((node) => node.id));
    for (const result of payload.results) {
      if (!validIds.has(result.peerId) || !finiteNumber(result.latencyMs, 0, 120_000) || !finiteNumber(result.lossPercent, 0, 100) || !Number.isInteger(result.samples) || result.samples < 1 || result.samples > 10) continue;
      const edge = { sourceId: current.id, peerId: result.peerId, latencyMs: result.latencyMs, lossPercent: result.lossPercent, samples: result.samples, checkedAt: now };
      const existing = state.links.findIndex((link) => link.sourceId === current.id && link.peerId === result.peerId);
      if (existing < 0) state.links.push(edge);
      else state.links[existing] = edge;
    }
    await persist();
    respond(response, 202, { accepted: true });
    return;
  }

  const nodeMatch = /^\/api\/v1\/agents\/([a-f0-9]{24})$/.exec(url.pathname);
  if (nodeMatch && request.method === "DELETE") {
    if (!adminAuthorized(request)) {
      respond(response, adminToken ? 401 : 503, { error: adminToken ? "需要管理员令牌" : "LINKPILOT_ADMIN_TOKEN 未配置" });
      return;
    }
    state.nodes = state.nodes.filter((node) => node.id !== nodeMatch[1]);
    state.links = state.links.filter((link) => link.sourceId !== nodeMatch[1] && link.peerId !== nodeMatch[1]);
    await persist();
    respond(response, 200, { deleted: true });
    return;
  }

  respond(response, 404, { error: "未找到 API 路由" });
}

await load();
if (adminToken.length < 32) {
  console.warn("LINKPILOT_ADMIN_TOKEN is missing or shorter than 32 characters; admin endpoints are disabled.");
}

const server = createServer((request, response) => {
  handle(request, response).catch((error) => {
    if (!response.headersSent) respond(response, error.status || 500, { error: error.status ? error.message : "内部错误" });
    else response.destroy();
  });
});
server.listen(port, host, () => console.log(`LinkPilot control API listening on ${host}:${port}`));
