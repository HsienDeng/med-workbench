# Med Work Frontend Gate

## Scope

This file governs everything under `med-work-frontend/`. Apply `med_work_backend/AGENTS.md` when changing the backend.

## Source of Truth

- Record non-obvious product decisions in repository documentation, not only chat history or comments.
- Keep navigation truth centralized in `src/constants/menu.tsx`, page keys in `src/types/index.ts`, and rendered pages in `src/App.tsx`.
- Prefer shared components and global design tokens over copying page-local presentation logic.

## Mechanical Gate

Run from `med-work-frontend/` before declaring completion:

```powershell
npx tsc --noEmit --pretty false
```

Do not run `npm build` or `npm run build` as a validation gate. Start or reuse the Vite dev server and visually verify changed UI at `http://localhost:8080/` unless the user explicitly requests a production build.

For interaction or layout changes, also verify:

- Primary mouse/keyboard paths still work.
- Desktop, narrow-desktop, and mobile layouts do not overflow.
- Loading, empty, invalid-input, and error states either remain correct or are updated deliberately.

If later CI adds an automated browser test suite, run its targeted tests instead of relying only on manual verification.

## Result Invariants

- Every `PageKey` used by menu state must have a render branch or be intentionally a phase-two placeholder.
- API calls must follow the typed request/response models in `src/types/`; never parse loosely typed assumptions into business state.
- Keep secrets out of source control. Local-only credentials need a visible warning and must not be presented as server-side configuration.
- New global CSS names must be specific enough to avoid colliding with another page and responsive where fixed grids are introduced.

## Repair Path

- Type error: correct the narrowest public type first; do not silence it with `any`.
- Navigation mismatch: reconcile `PageKey`, menu item, render branch, and target placeholder together.
- Runtime failure: reproduce through the Vite URL before changing implementation.
- Visual regression: compare against the existing Ant Design and global token patterns, then adjust the shared abstraction when three or more usages duplicate it.
