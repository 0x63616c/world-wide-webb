import "@testing-library/jest-dom/vitest";

// jsdom has no ResizeObserver; input-otp (the OTP field) constructs one on
// mount. A no-op shim is enough, the tests assert on DOM/behavior, not on
// resize callbacks.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
