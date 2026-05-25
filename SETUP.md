# Health Dashboard

## Run

```bash
docker compose up --build
```

Open **http://localhost:3001** — that's it. No npm, no native deps, nothing else to install.

---

## What happens on first start

1. Docker builds the image — compiles `better-sqlite3` inside the container
2. The entrypoint script seeds the data volume with default JSON files
3. Migration runs automatically — JSON → `spencer.db`
4. Server starts

Every subsequent `docker compose up` is instant (no rebuild unless you change code).

---

## Rebuilding after a code change

```bash
docker compose up --build
```

Your data volume is untouched — only the app code rebuilds.

---

## Multi-user

Click the avatar in the **bottom-left of the sidebar** to switch profiles or add a family member. Each person gets their own isolated database inside the volume.

---

## Apple Health Auto Export (live sync)

In the Health Auto Export iPhone app, create a REST API automation:

| Setting | Value |
|---------|-------|
| URL | `http://your-mac-ip:3001/api/spencer/import/apple-health` |
| Method | POST |
| Data Type | Health Metrics |
| Export Format | JSON |
| Aggregate | Enabled |

Replace `spencer` with any user's ID (shown in their profile).

---

## Backup & restore

```bash
# Backup
docker cp $(docker compose ps -q health):/data ./data-backup

# Restore
docker cp ./data-backup/. $(docker compose ps -q health):/data
```

---

## Grafana (Infinity datasource)

Point the Infinity plugin at your server — no extra setup needed:

```
Base URL:  http://host.docker.internal:3001
Endpoints: /api/spencer/body
           /api/spencer/blood
           /api/spencer/events
```
