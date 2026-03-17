## Bug Report

`builtin.web_search` tool fails with "All search providers failed" errors in production, and this is never caught by the test suite because there are no unit tests for the web tools execution path. The user-visible error bubbles up into agent responses with no actionable fallback information.

## Use Case

When the agent uses `builtin.web_search` to answer a question requiring current information, the tool execution throws and the agent cannot complete the task.

## Acceptance Criteria

1. Unit tests exist for `WebTools.executeBuiltin` that mock `fetch` and verify the full execution path for `web_search`, `web_fetch`, and `web_extract`.
2. Tests cover: successful results, 0 results (empty), provider fallback, all-providers-fail error, and timeout scenarios.
3. Tests cover the `parseDuckDuckGoHtmlResults` parser with representative HTML fixture data.
4. `getWebSearchProviderConfig` fallback to defaults is tested.
5. All tests pass under `npx jest --forceExit`.

## Technical Notes

- Tool execution path: `executeBuiltinWebTool` ? `WebTools.executeBuiltin` ? `WebTools.webSearch` ? per-provider fetch
- Provider config loaded from DB via `getWebSearchProviderConfig()` with fallback to defaults (both DuckDuckGo providers enabled)
- Error is `"All search providers failed. <details>"` when every configured enabled provider throws
- The HTML parser `parseDuckDuckGoHtmlResults` relies on regex patterns matching DuckDuckGo HTML structure

## Test Considerations

- Mock `fetch` globally in unit tests using `jest.spyOn(global, "fetch")`
- Provide representative DuckDuckGo HTML fixture for parser tests
- Test provider fallback: first provider returns 0 results, second returns results
- Test all-fail: both providers throw ? verify final error thrown
- Files: `tests/unit/tools/web-tools.test.ts` (new file)
