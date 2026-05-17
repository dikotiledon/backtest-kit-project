# Champion Tester

Standalone tool to test autoresearch champion strategies against arbitrary symbols with smart dataset management.

## Quick Start

```bash
cd scripts/champion-tester
npm install
npm run dev
```

- API server: http://localhost:3847
- Web UI: http://localhost:5173

## Architecture

- **Backend:** Express API (port 3847)
- **Frontend:** React 19 + Vite 6 + Tailwind CSS 4
- **Data:** ccxt for exchange data, JSON file storage
- **Execution:** Reuses pine-import-run-clean pipeline via cache materialization

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/health | Service health |
| GET | /api/timeframes | Available timeframes |
| GET | /api/datasets | List datasets |
| POST | /api/datasets/fetch | Fetch/update dataset |
| DELETE | /api/datasets/:exchange/:symbol/:tf | Delete dataset |
| GET | /api/champions | List champions |
| GET | /api/champions/:matrixId | Get champion details |
| POST | /api/test/run | Run champion test |
| GET | /api/results | List results |
| GET | /api/results/:runId | Get result |
| DELETE | /api/results/:runId | Delete result |

## Scripts

- `npm run dev` — Start both API and Vite dev servers
- `npm run build` — Build frontend for production
- `npm start` — Production server (serves built frontend)
- `npm test` — Run unit tests

## Isolation

- Separate package.json (own dependencies)
- Cache namespace: `champion-tester` (not `ccxt-exchange`)
- Read-only access to champion.json
- Single-run mutex (HTTP 409 if busy)
