# Wings On Docker Desktop (Local XyraPanel)

This guide runs a local Wings container with Docker Desktop and connects it to your local XyraPanel instance.

## Files Added

- `docker-compose.wings.yml` - Wings container stack
- `.env.wings.example` - Wings compose defaults
- `.env.wings.isolated.example` - isolated Wings compose defaults for app build testing
- `scripts/wings-init.mjs` - prepares local folders and config placeholder

## Quick Start

1. Prepare folders and local env:

```bash
pnpm wings:docker:init
```

2. Start Wings:

```bash
pnpm wings:docker:up
```

3. Check logs:

```bash
pnpm wings:docker:logs
```

4. Stop Wings:

```bash
pnpm wings:docker:down
```

## Isolated Wings For Build Testing

Use this when you want a second Wings instance completely separate from your primary local setup.

1. Prepare isolated folders and env:

```bash
pnpm wings:docker:isolated:init
```

2. Start isolated Wings:

```bash
pnpm wings:docker:isolated:up
```

3. Check isolated logs:

```bash
pnpm wings:docker:isolated:logs
```

4. Stop isolated Wings:

```bash
pnpm wings:docker:isolated:down
```

By default this isolated instance uses:
- API: `http://host.docker.internal:8180`
- SFTP: `2223`
- Config/log/tmp: `./.data/wings-isolated`
- Data/runtime: `/var/lib/pterodactyl-isolated` and `/run/wings-isolated`

Create a separate node in XyraPanel for this instance and paste that node's config into:

`./.data/wings-isolated/etc/config.yml`

## Connect To XyraPanel

1. Start XyraPanel on all interfaces so Docker can reach it:

```bash
pnpm exec nuxt dev --host 0.0.0.0 --port 3000
```

2. In XyraPanel Admin, create a node.
3. Set the node base URL to Wings, not the panel (for local Docker Desktop this is usually `http://host.docker.internal:8080`).
4. Open that node's **Configuration** view and copy the generated Wings config.
5. Paste it into:

`./.data/wings/etc/config.yml`

6. Important for Docker Desktop local dev:
- if the generated config `remote` URL is `http://localhost:3000`, change it to:
`http://host.docker.internal:3000`

7. Restart Wings:

```bash
pnpm wings:docker:down
pnpm wings:docker:up
```

8. In XyraPanel, use **Test Connection** on the node.

## Notes

- Wings ports are published from `.env.wings` (`8080` API, `2022` SFTP by default).
- Wings config/log/tmp are stored under `./.data/wings` by default.
- Wings server data and runtime paths default to `/var/lib/pterodactyl` and `/run/wings` on the Docker daemon host (`WINGS_DATA_PATH`, `WINGS_RUNTIME_PATH` in `.env.wings`).
- You can run multiple Wings containers side-by-side by giving each env file a unique `WINGS_CONTAINER_NAME`, `WINGS_NETWORK_NAME`, ports, and data/runtime paths.
- Those two paths must be identical on host and inside the Wings container, or server boots fail with `invalid mount config for type "bind"`.
- `WINGS_UID/WINGS_GID` default to `0` in local dev to avoid docker socket permission issues.
- In `.env`, set `WINGS_DOCKER_DESKTOP=true` to auto-rewrite generated Wings `remote` URLs from `localhost` to `host.docker.internal`.
- Generated Wings config now includes `allowed_origins` for panel websocket access, including common local aliases and detected local interface IPs.
- If you access the panel from a custom host/IP not covered automatically, add it via `WINGS_ALLOWED_ORIGINS` in `.env` (comma-separated, supports values like `localhost:3000` or `*`).
- Use `WINGS_REMOTE_URL` in `.env` if you want to force a specific panel URL in generated Wings config.
- If Wings logs `invalid pool request: Pool overlaps with other one on this address space`, set a non-conflicting docker network in config (for example `172.31.0.0/16`) and restart Wings.
