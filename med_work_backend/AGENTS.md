# Med Work Backend Gate

## Scope

This file governs everything under `med_work_backend/`. Apply `med-work-frontend/AGENTS.md` when changing the frontend.

## Source of Truth

- Store API contracts, authentication behavior, persistence rules, and operational decisions in this repository rather than chat history.
- Keep FastAPI boundaries directional: router → service → model/repository/configuration/schema. Services and models must not import routers.
- Treat `.env.example` as the discoverable contract for new settings; never document configuration only in code comments or conversation.

## Mechanical Gate

Run both commands from `med_work_backend/` before declaring completion:

```powershell
.\.venv\Scripts\python.exe -m compileall -q app
.\.venv\Scripts\python.exe -c "from app.main import create_app; create_app()"
```

For changed HTTP endpoints, background behavior, lifespan setup, or database migrations, exercise the running API—not only its imports—and record the exact verified endpoint and result. Health is available at `http://localhost:8001/api/health`.

When the project gains configured tests, linting, or type checking, add them to this section as mandatory commands; remove any gate that no longer applies so the list remains executable.

## Result Invariants

- Public HTTP inputs must pass through Pydantic schemas under `app/schemas/`.
- Protected endpoints must resolve identity and authorization through shared dependencies; endpoints must not improvise token parsing.
- Database access belongs behind SQLAlchemy sessions and typed models. Do not concatenate SQL strings.
- Secrets are read from settings/environment only. Never write real keys, passwords, tokens, or patient identifiers to logs, fixtures, examples, or Git.
- External Kimi failures must return controlled errors and leave enough diagnostics to distinguish missing configuration, network failure, provider rejection, and malformed response.

## Data and Compatibility

- Changing response fields requires checking all frontend callers under `../med-work-frontend/src/services/`, stores, and type declarations.
- Model or session changes must explain creation, expiry, cleanup, and seed behavior.
- Never mutate developer or clinical data without an explicit user-approved action.

## Repair Path

- Import/startup error: isolate whether configuration, database setup, router wiring, or a third-party integration changed.
- Authentication regression: verify registration/login/session lookup/logout and expired-token rejection before proceeding.
- Provider regression: test missing-key and success/error paths with stubs where possible; do not consume production quota without user approval.
- Contract mismatch: fix the authoritative schema and update dependent router/service/frontend types in the same change.
