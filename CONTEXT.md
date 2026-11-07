# Domain language

**Panel**: the physical iPad home-control installation. **App**: the shared native SwiftUI experience,
including iPhone/Duo and Mac. **Clock**: the first surface on every platform. **Launcher**: the slide-up
entry to retained features. **Feature provider**: client state and actions shared by feature views.

**Desired state** is a requested device setting; **reported state** is the actual Home Assistant observation.
A **command ownership window** prevents a stale observation overwriting fresh user intent. Physical switches
can still become the authoritative source after that window. **Worker cycle** means a supervised interval in
the single Rust process, never a separate queue or worker deployment.

**Photo Booth** means user-created camera captures and their persistent media. Legacy wake-capture data is
archival; missing historical wake images do not block this migration. **Enrollment** is the private per-device
connection record stored atomically in Keychain, including installation API and Cloudflare Access credentials.
