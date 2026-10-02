import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const directory = path.dirname(fileURLToPath(import.meta.url));
const serverFile = path.join(directory, "server.mjs");
const adminToken = "test-admin-token-with-at-least-32-chars";
let baseUrl;
let dataDir;
let processHandle;

async function availablePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForApi() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/v1/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error("control API did not start");
}

async function jsonRequest(route, { token, body, method = "GET" } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { response, body: await response.json() };
}

test("enrollment, telemetry authentication and peer probes work end to end", async (t) => {
  const port = await availablePort();
  dataDir = await mkdtemp(path.join(tmpdir(), "linkpilot-control-"));
  processHandle = spawn(process.execPath, [serverFile], {
    env: { ...process.env, LINKPILOT_PORT: String(port), LINKPILOT_ADMIN_TOKEN: adminToken, LINKPILOT_DATA_DIR: dataDir },
    stdio: "ignore",
  });
  baseUrl = `http://127.0.0.1:${port}`;
  t.after(async () => {
    processHandle.kill("SIGTERM");
    await new Promise((resolve) => processHandle.once("exit", resolve));
    await rm(dataDir, { recursive: true, force: true });
  });
  await waitForApi();

  const health = await jsonRequest("/api/v1/health");
  assert.equal(health.response.status, 200);

  const denied = await jsonRequest("/api/v1/telemetry");
  assert.equal(denied.response.status, 401);

  const createEnrollment = async () => {
    const result = await jsonRequest("/api/v1/enrollment-tokens", { method: "POST", token: adminToken });
    assert.equal(result.response.status, 201);
    return result.body.enrollmentToken;
  };

  const enrollNode = async (enrollmentToken, name, address) => {
    const result = await jsonRequest("/api/v1/agents/enroll", {
      method: "POST",
      body: { enrollmentToken, name, region: "test", probeAddress: address, probePort: 443, accessMode: "direct" },
    });
    assert.equal(result.response.status, 201);
    return result.body;
  };

  const firstEnrollment = await createEnrollment();
  const first = await enrollNode(firstEnrollment, "test-a", "127.0.0.1");
  const replay = await jsonRequest("/api/v1/agents/enroll", {
    method: "POST",
    body: { enrollmentToken: firstEnrollment, name: "replay", region: "test", probeAddress: "127.0.0.1", probePort: 443, accessMode: "direct" },
  });
  assert.equal(replay.response.status, 401);

  const second = await enrollNode(await createEnrollment(), "test-b", "127.0.0.1");
  const metrics = { agentVersion: "test", cpuPercent: 12.5, memoryPercent: 48, diskPercent: 30, diskTotalBytes: 10000, uptimeSeconds: 123, rxBytes: 1000, txBytes: 500, rxMbps: 1.2, txMbps: 0.7, system: { hostname: "edge-test", os: "Debian 13", platform: "linux", kernel: "6.12", architecture: "x64", cpuCount: 4, cpuModel: "Test CPU", memoryTotalBytes: 4096, interfaces: ["eth0"] } };
  for (const node of [first, second]) {
    const heartbeat = await jsonRequest("/api/v1/agents/heartbeat", { method: "POST", token: node.agentToken, body: metrics });
    assert.equal(heartbeat.response.status, 202);
  }

  const peers = await jsonRequest("/api/v1/agents/peers", { token: first.agentToken });
  assert.equal(peers.response.status, 200);
  assert.deepEqual(peers.body.peers.map((peer) => peer.id), [second.id]);

  const probe = await jsonRequest("/api/v1/agents/probes", {
    method: "POST",
    token: first.agentToken,
    body: { results: [{ peerId: second.id, latencyMs: 42, lossPercent: 0, samples: 3 }] },
  });
  assert.equal(probe.response.status, 202);

  const telemetry = await jsonRequest("/api/v1/telemetry", { token: adminToken });
  assert.equal(telemetry.response.status, 200);
  assert.equal(telemetry.body.nodes.length, 2);
  assert.equal(telemetry.body.nodes[0].status, "online");
  assert.equal(telemetry.body.nodes[0].tokenHash, undefined);
  assert.equal(telemetry.body.nodes[0].history.length, 1);
  assert.equal(telemetry.body.nodes[0].system.os, "Debian 13");
  assert.deepEqual(telemetry.body.nodes[0].system.interfaces, ["eth0"]);
  assert.deepEqual(telemetry.body.links[0], {
    sourceId: first.id,
    peerId: second.id,
    latencyMs: 42,
    lossPercent: 0,
    samples: 3,
    checkedAt: telemetry.body.links[0].checkedAt,
  });
});
