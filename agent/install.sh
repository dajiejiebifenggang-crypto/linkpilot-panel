#!/usr/bin/env bash
set -Eeuo pipefail

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  echo "Run with sudo: sudo env LINKPILOT_*='<values>' bash" >&2
  exit 1
fi

: "${LINKPILOT_CONTROL_URL:?Set LINKPILOT_CONTROL_URL}"
: "${LINKPILOT_ENROLL_TOKEN:?Set LINKPILOT_ENROLL_TOKEN}"
: "${LINKPILOT_NAME:?Set LINKPILOT_NAME}"
: "${LINKPILOT_REGION:?Set LINKPILOT_REGION}"
: "${LINKPILOT_PROBE_ADDRESS:?Set LINKPILOT_PROBE_ADDRESS}"

if ! command -v node >/dev/null 2>&1; then
  if ! command -v apt-get >/dev/null 2>&1; then
    echo "Node.js is missing. Install Node.js 18+ using your OS package manager, then retry." >&2
    exit 1
  fi
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs ca-certificates curl
fi

node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [ "$node_major" -lt 18 ]; then
  echo "Node.js 18+ is required; found $(node --version)." >&2
  exit 1
fi

install -d -m 0755 /opt/linkpilot
install -d -m 0750 /etc/linkpilot
curl -fsSL "${LINKPILOT_AGENT_URL:-https://raw.githubusercontent.com/dajiejiebifenggang-crypto/linkpilot-panel/main/agent/agent.mjs}" -o /opt/linkpilot/agent.mjs
chmod 0755 /opt/linkpilot/agent.mjs

export LINKPILOT_AGENT_CONFIG=/etc/linkpilot/agent.json
node /opt/linkpilot/agent.mjs enroll --install-service
unset LINKPILOT_ENROLL_TOKEN

echo "LinkPilot Agent installed. Check status with: systemctl status linkpilot-agent"
