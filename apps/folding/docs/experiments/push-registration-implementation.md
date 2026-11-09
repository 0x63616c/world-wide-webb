# Native push lifecycle implementation

November 7, 2026. Delivery acceptance remains a final-pass/device check.

`FoldingPushAppDelegate` is the native UIApplication/UNUserNotificationCenter
adapter. It forwards APNs token changes/failures to `PushRegistration`, selectively
shows foreground banners, and queues a validated result destination until the
composition root confirms authentication and membership are ready. The delegate
never requests notification consent. Local daily-limit foreground consent is a
separate injected flag so private reminders do not depend on APNs signing setup.

The coordinator registers with APNs only when a competition participant is present,
weekly/monthly results are opted in, and OS authorization allows notifications.
Turning both result categories off unregisters from APNs and sends authenticated
DELETE to remove the server binding. Permission revocation follows the same path.
Tokens, acknowledged bindings, and retry operation IDs live in device-only,
non-synchronizing Keychain storage; no token is printed or placed in defaults.
Changes during an in-flight registration cause reconciliation after its response.
The controller attempts deactivation before clearing session credentials, and discards
binding metadata only after confirmed server removal. Offline unregister cannot block
privacy removal; backend purge and token reassignment remain the security boundary.

Topic is the signed app bundle identifier. APNs environment maps from the exact
`FOLDING_APNS_ENVIRONMENT` signing setting through `FoldingAPNSEnvironment` in
Info.plist: development → sandbox; production → production. Missing/unknown
configuration fails closed. No environment is inferred from Debug or a user toggle;
the backend independently checks the allowed deployment topic/environment.

Result preference writes use authenticated PUT `/v1/preferences`, including
weekly/monthly mode, home timezone, and supported locale. A durable operation ID
supports retry; success requires the server's matching saved response. The caller
persists the presented preference only after acceptance. Missing endpoints produce
real errors rather than successful local-only result notification settings.

Frozen result APNs payload (agreed with backend agent):

```json
{"aps":{"alert":{}},"folding":{"kind":"weekly_result","period_id":"opaque-period-id"}}
```

`monthly_result` is the other accepted kind. Period IDs are bounded opaque strings;
there are no identity, tracking, auth, or mutation commands in payloads. A tap only
requests the authenticated Results destination. Account removal discards queued
routes. The backend owns filtering, scheduled delivery, deduplication and APNs keys.

The app/widget generic simulator build succeeded with the native push files.
No registration, permission prompt, endpoint mutation, or actual notification was
performed during implementation. Runtime hookup is implemented. Retry/account-race validation,
foreground/tap UI, sandbox APNs delivery, and device signing verification remain
final integration acceptance.
