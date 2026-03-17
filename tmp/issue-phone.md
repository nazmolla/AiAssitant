## Bug Report

Outbound phone calls (Twilio) end immediately after the agent finishes its greeting. There is no `<Gather>` block in the TwiML response for outbound calls, so Twilio plays the message and hangs up with no opportunity for the callee to respond.

## Use Case

The agent initiates a reminder call. The user picks up and hears "This is Nexus — you have a meeting in 15 minutes." The call ends before the user can say anything. The user cannot confirm, get more info, or interact with the agent at all.

## Acceptance Criteria

1. Outbound calls include a `<Gather input="speech">` block so the callee can respond.
2. The Gather `action` URL is constructed from `NEXTAUTH_URL` env variable + `/api/channels/{channelId}/webhook?secret={secret}`.
3. If `NEXTAUTH_URL` is not set, the call falls back to announcement-only mode (current behaviour) and logs a warning.
4. Inbound call flow is unchanged and continues to work correctly.
5. Unit tests for `buildTwimlResponse` verify both modes: with and without action URL.
6. Unit tests for `PhoneChannel.send()` verify the correct TwiML is generated for outbound calls when `NEXTAUTH_URL` is set.

## Technical Notes

- Root cause: `phone-channel.ts` `send()` calls `buildTwimlResponse(message, "", voiceName)` — empty actionUrl skips the Gather block
- Fix: construct `actionUrl = ${process.env.NEXTAUTH_URL}/api/channels/${this.channel.id}/webhook?secret=${this.channel.webhook_secret}` and pass it to `buildTwimlResponse`
- `NEXTAUTH_URL` is the canonical server base URL (already required in `.env`)
- Webhook function at `src/app/api/channels/[channelId]/webhook/route.ts` already handles phone speech input correctly when called back by Twilio

## Test Considerations

- Unit tests for `buildTwimlResponse` in `tests/unit/services/phone-service.test.ts`
- Verify outbound TwiML includes `<Gather>` when actionUrl is provided
- Verify Gather action URL is correctly formed with channel ID and secret
- Verify fallback (no NEXTAUTH_URL ? just `<Say>` with warning log)
