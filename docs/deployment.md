# LinkPilot Deployment (0.2 MVP)

This release adds a self-hosted control API and a read-only Linux telemetry agent. The GitHub Pages site remains a static frontend; it does not itself store credentials or contact nodes until an operator connects it to a control API.

## Scope and safety

Implemented: one-time agent enrollment, bearer-token authentication, 10-second heartbeat, CPU/memory/disk/network counters, 5-second browser refresh, a 360-sample metric history, and TCP reachability probes among explicitly registered endpoints. Node status is online while a heartbeat is newer than 30 seconds.

The agent does not execute shell commands after installation, change routes, install Gost/Realm/VPN software, generate WireGuard keys, or apply SD-WAN configuration. The mesh view is a directed TCP probe graph, not an encrypted VPN tunnel. Probe failure percentage is TCP connection failure rate, not ICMP packet loss. Configuration-changing adapters require a separate reviewed implementation and approval/rollback workflow.

## Requirements

- Control host: Node.js 20.9+; for Docker, Docker Engine and Compose v2.
- Agent host: Debian/Ubuntu Linux and Node.js 18+. The installer can install Debian's `nodejs` package when missing.
- Agents need outbound HTTPS access to the control API. They do not require inbound SSH or a public IP for heartbeats.
- Public deployments require TLS. Do not expose port 8787 directly to the Internet.

## Local development on Windows

From the repository root, open two PowerShell terminals.

Terminal A:

```powershell
$env:LINKPILOT_ADMIN_TOKEN = ( [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N') )
$env:LINKPILOT_ALLOWED_ORIGINS = 'http://localhost:3000'
npm run api
```

Keep the generated token in this terminal; do not commit it or paste it into chat.

Terminal B:

```powershell
npm ci
npm run dev
```

Open `http://localhost:3000`, go to **服务器接入**, enter API URL `http://localhost:8787`, and paste the token into the password field. The token exists only in page memory and is cleared when disconnected or the page is closed.

Run checks:

```powershell
npm run test:control
npm run lint
npm run build
```

## Self-hosted control plane with Docker

1. Clone the public repository on a server with Docker Compose installed.
2. Create a private environment file and strong administrator token:

```bash
cp .env.example .env
openssl rand -hex 32
chmod 600 .env
```

Put the generated random value in `LINKPILOT_ADMIN_TOKEN`. Set `LINKPILOT_ALLOWED_ORIGINS` to the exact browser origin, such as `https://panel.example.com:8443`; do not use `*`.
3. Start the services:

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 control web
```

The frontend listens on `127.0.0.1:3000`; the API listens on `127.0.0.1:8787`. API state is stored in the named Docker volume `linkpilot-data`. Back up this volume; it contains node identities and telemetry, but only hashed node tokens.
4. Put an HTTPS reverse proxy in front of both services. Route `/api/` to `127.0.0.1:8787` and all other paths to `127.0.0.1:3000`. The browser should use the same HTTPS origin for the control API.

Example Nginx site when TCP 443 is already occupied by another service. Use a valid certificate for `panel.example.com`, and open TCP 8443 in the host/provider firewall:

```nginx
server {
    listen 8443 ssl;
    server_name panel.example.com;
    ssl_certificate /etc/letsencrypt/live/panel.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/panel.example.com/privkey.pem;

    location /api/ {
        proxy_pass http://127.0.0.1:8787/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

If using port 8443, add `https://panel.example.com:8443` to `LINKPILOT_ALLOWED_ORIGINS` and set the frontend's API URL to `https://panel.example.com:8443`. Restart the Compose services after changing `.env`. The existing LinkPilot relay VPS uses TCP/UDP 443; do not start another listener on that port unless you have deliberately changed the relay topology.

Health check:

```bash
curl -fsS https://panel.example.com:8443/api/v1/health
```

## Add a direct or FRP-probed server

1. Open **服务器接入** in the panel. Enter the HTTPS control API URL and `LINKPILOT_ADMIN_TOKEN` from the private control host environment.
2. Select **添加服务器**, enter a label, region, probe address, probe port, and connection mode.
3. Direct mode: use the node's reachable public address and a TCP service port that the node intentionally exposes.
4. FRP mode: use the public FRPS hostname and the dedicated remote port assigned to this node. Keep a one-to-one mapping; never expose SSH/RDP just to obtain a green status. The Agent's control heartbeat remains outbound HTTPS and does not depend on FRP.
5. The panel creates a random enrollment token valid for 15 minutes and one use. Copy the generated command directly to the target Linux server. It downloads `agent/install.sh`, installs the Agent, enrolls it, stores the per-node token in `/etc/linkpilot/agent.json` with restricted permissions, and creates `linkpilot-agent.service`.
6. The persistent service runs as the unprivileged `linkpilot` system user. Check it with:

```bash
systemctl status linkpilot-agent
journalctl -u linkpilot-agent -n 100 --no-pager
```

To remove a node from the control panel, use its remove action. That revokes its stored node identity but intentionally does not remotely uninstall software. Uninstall on the node with `systemctl disable --now linkpilot-agent`, then remove `/etc/linkpilot/agent.json`, `/etc/systemd/system/linkpilot-agent.service`, `/opt/linkpilot/agent.mjs`, and the `linkpilot` system user.

## FRP / NAT notes

For common NAT nodes, outbound Agent HTTPS is simpler and safer than exposing the node; FRP is not required for telemetry. FRP mode only changes the address/port used by the TCP peer probe. Run FRPS on a reachable relay, configure a unique remote port for each node, and enter that mapped endpoint in the server enrollment form. If the control API itself is behind NAT, publish it through an HTTPS reverse proxy/tunnel and set the Agent's control URL to that HTTPS hostname. Protect FRP with authentication, TLS transport, firewall allowlists, and narrow port mappings.

## API and source map

- `control/server.mjs`: HTTP API, CORS allowlist, bearer authentication, enrollment token expiry, state persistence, telemetry validation, and status projection. Default bind is loopback; containers override it to their private bridge interface.
- `control/server.test.mjs`: end-to-end tests for enrollment replay rejection, authentication, heartbeats, and peer probes.
- `agent/agent.mjs`: read-only Linux collectors, outbound heartbeat, three TCP probes per registered peer, and locked-down systemd unit creation.
- `agent/install.sh`: download/install/enroll entry point; requires an explicit one-use enrollment token.
- `app/server-console.tsx`: transient admin-token entry, live polling, server enrollment wizard, host details, and probe graph.
- `compose.yaml`, `Dockerfile`: self-hosted Next.js frontend and separate API services.

## Current limitations

- JSON state storage is for a single control API instance, not HA or multi-writer deployments. Use backups and do not run multiple API replicas against one file volume.
- No route changes, DNS changes, firewall mutations, process execution, SSH credential storage, L2TP/OpenVPN/WireGuard/IPsec provisioning, Gost/Realm installation, or encrypted SD-WAN overlay is implemented yet.
- Regional latency depends on ISP routing. FRP does not eliminate carrier QoS or guarantee zero jitter/loss.
