## Development

```bash
make dev
```

Installs client dependencies, starts the API server on port 3001 and the Vite dev server on port 5173 (with hot reload). Open `http://localhost:5173` in your browser, or use the mobile preview vscode extension

## Getting Your User ID

Create a user in the web UI or via `GET /api/users` to list existing users. The ID is auto-generated from the user's name.

## Auto Health Export

Configure Apple Health apps to POST data to `http://your-dashboard:3001/api/{userId}/import/apple-health`. Metrics are automatically mapped to the dashboard (e.g., `body_mass` → weight).

## Related

https://github.com/nixfred/apple-health-dashboard