## Bug Report

All batch schedule creation requests fail with HTTP 400 `{"error":"batch_type must be one of proactive|knowledge|cleanup|email|job_scout"}`. Additionally, the batch parameter form shows irrelevant free-text fields that do not match the parameters actually consumed by the batch job classes.

## Use Case

An admin navigates to Settings > Batch Scheduler, clicks "New Email Reading Batch", fills in the recurrence, and clicks OK. The request returns a 400 error and no schedule is created. This affects all four batch types: proactive, knowledge, cleanup, and email.

## Acceptance Criteria

1. Batch schedule creation succeeds for all four types: proactive, knowledge, cleanup, email.
2. The frontend POST body sends `batch_type` (not `batch_job_type`) and `parameters` (not `batch_parameters`).
3. Parameter fields shown in the modal exactly match the parameters defined in each batch job class.
4. All parameter inputs are dropdowns (`<select>`) — no free-text inputs for batch parameters.
5. The proactive batch shows no parameter fields (it has none).
6. The knowledge batch shows a "Poll Seconds" dropdown (30s, 60s, 120s, 300s, 600s).
7. The cleanup batch shows a "Log Level" dropdown (verbose, info, warning, error).
8. The email batch shows a "Max Messages Per Run" dropdown (10, 25, 50, 100, 200).
9. Integration tests for POST /api/scheduler/schedules pass for all batch types.

## Technical Notes

- Root cause: `scheduler-config.tsx` L144 sends `batch_job_type` and `batch_parameters`; API (`schedules/route.ts` L35) reads `batch_type` and `parameters`
- Secondary issue: `batchParameterDefs` in frontend defines wrong keys (`email_accounts`, `email_sync_interval`, etc.) that do not match `BatchJobParameterDefinition` in the batch job classes
- Actual parameters per class:
  - `ProactiveBatchJob`: none
  - `KnowledgeBatchJob`: `pollSeconds` (number, default 60)
  - `CleanupBatchJob`: `logLevel` (select: verbose/info/warning/error, default warning)
  - `EmailBatchJob`: `maxMessages` (number, default 25)

## Test Considerations

- Update `tests/integration/api/scheduler-api.test.ts` to verify all four batch type creations succeed
- Add component test in `tests/component/scheduler-config.test.tsx` verifying the submit payload contains `batch_type` and `parameters` with correct keys
- Verify the correct dropdown options appear per batch type
