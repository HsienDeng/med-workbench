# my-vben-admin

> Standalone frontend scaffold extracted from [vue-vben-admin](https://github.com/vbenjs/vue-vben-admin) via [create-vben-admin](https://github.com/379949990/create-vben-admin).

[中文 README](./README.md)

## Overview

| Field             | Value                                  |
| ----------------- | -------------------------------------- |
| UI template       | `web-ele` (Element Plus) |
| upstream ref      | `v5.7.0`                              |
| create-vben-admin | `1.0.1`           |

This repo uses a **flat layout**: application code lives at the repository root; required upstream workspace packages are kept under `packages/` and `internal/` and usually do not need edits.

## Quick start

```bash
pnpm install   # skip if already done during create-vben-admin
pnpm dev
```

The dev server port is controlled by `VITE_PORT` in `.env.development` (currently **5777**). Always follow the URL printed in your terminal.

## Scripts

| Command          | Description              |
| ---------------- | ------------------------ |
| `pnpm dev`       | Development server       |
| `pnpm build`     | Production build         |
| `pnpm preview`   | Preview production build |
| `pnpm typecheck` | TypeScript check         |

## Backend (med_work_backend)

This project talks to a real backend — **med_work_backend** (FastAPI). All mock artifacts have been removed.

### Start order

1. Start the backend first: `http://localhost:8001` (routes already include the `/api` prefix)
2. Then start the frontend: `pnpm dev` (port **5777**)

### Proxy & API conventions

| Item            | Value                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------ |
| Proxy           | `/api` → `http://localhost:8001` (no rewrite)                                               |
| Auth            | `Authorization: Bearer <token>`; login via `POST /api/auth/login {account,password}`        |
| Response        | Raw payload (no `code`/`data` wrapper); errors use HTTP status + `{code,message}`           |
| Refresh token   | None; HTTP 401 logs the user out                                                            |
| Permission codes| From `GET /api/auth/me` → `permissions`; used for menu filtering and `v-access:code`        |

### Pages

| Path            | Description                                                        |
| --------------- | ------------------------------------------------------------------ |
| `/assistant`    | AI assistant chat (landing page, streaming + knowledge citations)  |
| `/patients`     | Patient records (list + detail + timeline + evolution + export)    |
| `/documents`    | Documents (upload / download / preview / versions / AI summary)     |
| `/prompts`      | Prompt templates                                                   |
| `/dictionaries` | Dictionaries                                                       |
| `/accounts`     | Accounts                                                           |
| `/permissions`  | Roles & permissions                                                |
| `/audit`        | Audit log                                                          |

## API reference (OpenAPI)

The real backend ships its own interactive docs:

- **FastAPI Swagger**: http://localhost:8001/docs
- **OpenAPI JSON**: http://localhost:8001/openapi.json

Import into Apifox: Project settings → Import → OpenAPI → paste the URL above.

## Mock server (removed)

Removed from this repo: `apps/backend-mock/`, the `viteNitroMockPlugin` in `internal/vite-config` (plus `nitropack` / `get-port` deps), `scripts/remove-mock.mjs`, `docs/mock-api.openapi.json`, and the `VITE_NITRO_MOCK` env var.

## Notes

- Other `apps/web-*` templates from upstream are not copied.
- To refresh the vben baseline, re-run create-vben-admin with a newer upstream ref or merge upstream changes manually.
- For further upstream slimming, see the [official Vben thin guide](https://doc.vben.pro/guide/introduction/thin.html) (unrelated to mock removal).

## Links

- [Vben Admin docs](https://doc.vben.pro/)
- [vue-vben-admin](https://github.com/vbenjs/vue-vben-admin)
- [create-vben-admin](https://github.com/379949990/create-vben-admin)

## License

MIT (application code follows upstream and create-vben-admin generation notes; see file headers where applicable.)
