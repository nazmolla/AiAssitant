## Feature Request
Improve dependency-injection boundaries and repository structure hygiene for maintainability and safer runtime behavior.

## Use Case
Current API route handlers and tool execution paths still contain direct DB/policy coupling that makes testing and change isolation harder. The repository also has script/root sprawl and runtime artifacts that should be organized and ignored consistently.

## Acceptance Criteria
1. API route DI seams are improved for key routes (thread/chat/admin/log-related handlers) by reducing direct DB imports/calls and routing through injectable services or helper modules.
2. Tool executor policy wiring is decoupled from hard-coded direct dependencies and supports clearer injection/override boundaries.
3. Scripts are categorized into clear folders (`scripts/db`, `scripts/ops`, `scripts/debug`) with imports/paths updated.
4. Root-level script clutter is reduced via consolidation/relocation where appropriate.
5. `.gitignore` is hardened to exclude runtime/generated artifacts currently prone to accidental tracking.
6. Documentation is updated to reflect script/test architecture locations and conventions.
7. Lint, full Jest, vulnerability audit, deploy via `deploy.sh`, and post-deploy health/log checks all pass.

## Technical Notes
- Preserve existing behavior and command interfaces unless compatibility shims are required.
- Favor small, composable service adapters for DI rather than broad rewrites.
- Keep changes surgical and aligned with existing TypeScript/Next.js project conventions.
- Avoid secret exposure and avoid any changes that read or leak production secret values.

## Test Considerations
- Unit tests for newly introduced DI seams/adapters.
- Integration tests for updated API route behavior (success/error/auth paths).
- Verify no regressions in workflow tools/tool policy execution.
- Run full suite: `npx jest --forceExit`.
- Run lint: `npm run lint -- --max-warnings 0`.
- Run vulnerability audit: `npm audit --audit-level=moderate`.
