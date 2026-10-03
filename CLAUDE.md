# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
make dev          # installs root + client deps, sources .envrc, runs server.js (:3001) and vite (:5173)
make clean        # DELETES local data/*.db — wipes every local user's data
make build-container / stop-container   # Apple `container` runtime, binds ./data to /data
make build-podman / stop-podman         # podman compose
make publish      # POSTs the Dockhand webhook to redeploy (needs DOCKHAND_WEBHOOK_SECRET)
npm run migrate   # scripts/migrate.js — JSON seeds → SQLite, idempotent
```

Vite proxies `/api` → `localhost:3001`, so work against `http://localhost:5173` in dev. In production Express serves `client/dist` and has an `app.get('*')` SPA fallback, so the whole app is on `:3001`.

There is no test suite and no linter configured. Verification is `node --check server.js` / `node --check db.js` plus exercising endpoints with curl against a running dev server.

`ANTHROPIC_API_KEY` is required — `server.js` calls `process.exit(1)` at boot without it. `.envrc` fetches it (and the Dockhand secret) via `op read` from 1Password; `make dev` sources `.envrc` itself.

## Architecture

Express API (`server.js`, single file, ~1370 lines) + `db.js` for SQLite + a Vite/React SPA in `client/`. No router, no ORM, no state library.

### Everything is one EAV table

`metrics(date, metric, value, source)` with `UNIQUE(date, metric, source)` holds all time-series data — body comp, sleep, labs, exercise, heart rate. Adding a new metric requires **zero schema change**; writes are `INSERT ... ON CONFLICT DO UPDATE`.

The per-section endpoints are just filters over that one table, driven by constants near the top of `server.js`:

- `BODY_METRICS`, `SLEEP_METRICS`, `EXERCISE_METRICS`, `HEARTRATE_METRICS` are **include** lists.
- `GET /api/:userId/blood` is the **complement** — every metric *not* in those four lists.

Consequence: a new body/sleep/exercise/HR metric that isn't added to its section constant will silently surface under Labs instead.

`pivotMetrics()` flattens rows into one object per date. When several sources wrote the same metric on the same date, the highest `id` wins — which is why `GET /sleep` re-derives `bedtime` (earliest) and `wake_time` (latest) across sources afterwards instead of trusting the pivot.

### Per-user databases

One SQLite file per user at `DATA_DIR/<userId>.db` (`DATA_DIR` = `./data` locally, `/data` in the container), connections cached in `db.js`. The user list itself lives in `DATA_DIR/users.json`, not in SQLite — `readUsers`/`writeUsers` plus the `requireUser` middleware, which resolves `:userId` into `req.user` on nearly every route. User IDs are slugified from the name.

Schema evolution in `getDb()`: new **tables/indexes** go in the `SCHEMA` string (all `IF NOT EXISTS`, executed on every open); new **columns on existing tables** go below it as `try { db.exec('ALTER TABLE ... ADD COLUMN ...') } catch {}`. Both run on every connection open, for every user DB.

### Reference ranges are layered

`BLOOD_MARKERS` in `server.js` is the hardcoded baseline (calibrated against Rythm Health's Optimal/Average zones). `GET /blood` clones it, then overlays `range_low`/`range_high`/`unit` from the `marker_configs` table (written by PDF import). `optimal_low`/`optimal_high` **only ever** come from the hardcoded table — an imported lab's printed range never overwrites the tighter optimal zone.

### Lab/InBody import is two-phase, by design

1. `POST /import/labs-pdf` — sha256 the upload (duplicate → 409), store it at `DATA_DIR/pdfs/<hash><ext>`, send it to Claude as a `document`/`image`/text block with `LAB_SYSTEM_PROMPT`, and return the parsed JSON **without touching the DB**.
2. Client shows a preview so the user can review/toggle values — this lives inline in `ImportSection.jsx`; `components/OcrPreviewModal.jsx` is dead code (nothing imports it, and its `onConfirm` drops `file_hash`/`filename`).
3. `POST /import/labs-confirm` inserts the `lab_reports` row first, then stamps its id onto every `metrics` row it writes via `lab_report_id`.

That stamp is what makes `DELETE /lab-reports/:id` able to cleanly undo a bad import (it also has a legacy fallback matching on date + marker name for rows written before the column existed). The OCR model id is hardcoded in the `anthropic.messages.create` call in `/import/labs-pdf`.

### Apple Health ingest (`POST /api/:userId/import/apple-health`)

Target of the Health Auto Export iPhone app. `HAE_METRIC_MAP` renames HAE metrics; `null` means explicitly ignore; **unmapped names pass through as-is**, so new metrics land in the DB without code changes.

Sleep has three separate code paths in the same handler, and this is the most fragile part of the codebase:

- **Raw per-stage intervals** (HAE "Summarize Data" *off* — what the README tells users to configure): each interval's `date` is just its calendar day, not a night. Intervals are clustered per source with a 4-hour gap threshold, then each cluster is assigned an "owner night": start ≥ 19:00 → next calendar day, start < 02:00 → same day, anything else is treated as a nap and skipped. Clusters are accumulated per `(source, ownerDate)` before writing so a night split by a wake disturbance sums rather than overwrites.
- **Compound nightly objects** (`totalSleep`/`deep`/`rem`/`core`, Summarize on) — nap filter only.
- Plain `qty` points for everything else.

Workouts are aggregated per day into `workout_count`, `exercise_minutes` and `hr_z1_min`…`hr_z5_min`, using max HR = `220 - age` from the user's `birth_year` (auto-extracted from HAE's `date_of_birth` on first sync if unset).

### Client

`UserContext` holds the active user (`localStorage: hd_userId`); `App.jsx` keeps the active section in `localStorage: activeSection` and per-user hidden sections in `health_hidden_sections_<userId>`. All HTTP goes through the single `api` object in `client/src/api.js` — add endpoints there, not inline `fetch` in components. One `*Section.jsx` component per dashboard section; charts are Recharts; PNG export uses html2canvas.

Styling is a dark theme with literal hex values inline in components (`bg-[#131d2e]`, `text-[#94a3b8]`, accent `#7c3aed`). `tailwind.config.js` defines named colors but most components predate them — match the surrounding file rather than converting.

## Deployment

Multi-stage Dockerfile: `node:20` builds (compiles `better-sqlite3`, builds the client), `node:20-slim` runs. `docker-entrypoint.sh` seeds the empty `/data` volume from the baked-in `/app/data-defaults` (`cp -rn`, never clobbers), runs `scripts/migrate.js` (idempotent `INSERT OR IGNORE`), then starts the server. `compose.yaml` publishes no ports — docktail labels expose it on the Tailscale tailnet. Pushes to `main` trigger `.forgejo/workflows/docker-build-push.yml`, which pings Dockhand to redeploy and pushes an image to the Forgejo registry.
