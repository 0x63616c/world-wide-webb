# Captive Portal

Product boundary for guest WiFi onboarding.

The frontend app lives in `products/captive-portal/apps/frontend`.

The product-owned API boundary lives in `products/captive-portal/apps/api`. It exposes only the portal tRPC surface (`portal.sendCode`, `portal.verifyCode`, `portal.checkPassword`, `portal.authorize`, `portal.status`, and `portal.resetAttempts`) and declares its Resend, UniFi, logger, and secret inputs explicitly. The current production proxy can still route through the Control Center API for rollback until the M5 runtime/database cutover lands.
