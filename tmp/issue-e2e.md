## Bug Report

Playwright E2E tests do not test any actual UI features or user flows. The entire test suite consists of 2 render-only smoke tests that only verify the sign-in page and root route load without crashing. No scheduler creation, chat, search, phone, knowledge management, or admin configuration is tested end-to-end. Any regression in these flows passes the full test suite undetected.

## Use Case

A developer makes a change to the batch scheduler modal UI. All Jest tests and Playwright tests pass. The change silently broke batch creation for all types. The bug ships to production.

## Acceptance Criteria

1. Playwright tests cover the complete user authentication flow (sign in, verify session).
2. Tests cover the chat interface: send a message, verify response appears.
3. Tests cover batch scheduler creation: open modal, fill required fields, submit, verify success.
4. Tests cover the admin settings pages: search providers, channels, tool policies.
5. Tests cover the scheduler list view: schedules appear after creation.
6. Each test uses `page.goto()`, `page.fill()`, `page.click()`, and `expect(page.locator(...))` assertions.
7. Tests pass when run with `npx playwright test`.

## Technical Notes

- Playwright config is at `playwright.config.ts`, base URL `http://localhost:3001`
- Existing tests: `tests/e2e/ui-smoke.spec.ts` (2 render-only tests)
- App requires authentication — tests need to handle sign-in flow
- Batch scheduler modal is in `src/components/scheduler-config.tsx`
- Admin settings panel is in `src/app/[[...path]]/page.tsx`

## Test Considerations

- Add `tests/e2e/auth.spec.ts` for authentication flow
- Add `tests/e2e/chat.spec.ts` for chat feature
- Add `tests/e2e/scheduler.spec.ts` for batch scheduler creation
- Add `tests/e2e/admin-settings.spec.ts` for admin configuration pages
- Use `page.waitForResponse` or `page.waitForSelector` to handle async load states
