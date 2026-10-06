# Cold-start HTML cache

Control Center on iPhone uses the Expo shell's hosted WKWebView, not a separate
native dashboard. The web build also works in Safari / a home-screen web app.

The earlier blank-screen fix (#776) added `no-cache` to newly served HTML and a
15-second render watchdog. Its first navigation still used the plain server URL;
only recovery used `?shellBoot=1`. An entry cached **before** those response
headers existed could therefore be reused without contacting nginx at all. New
server headers cannot invalidate that already-fresh local entry. If its named
bundle was gone/evicted, the shell waited 15 seconds, then another second of
backoff, before fetching a working document. The next cold start returned to the
same cached plain URL. This explains the repeatable roughly-20-second
blank/recovery path, rather than an API query blocking React's first render.

The shell now stamps the HTML URL on **generation zero** with a launch timestamp
held stable in React state, plus the recovery generation. Re-renders do not
reload the page; new launches and retries cannot reuse the old document URL.
Content-hashed `/assets/` URLs remain unchanged and cacheable. The watchdog and
backoff are unchanged: they still recover genuinely failed loads, but are not
the mechanism for normal cold startup. No loading screen conceals the delay.

## Evidence and regression

`bunx playwright install webkit && bun run test:panel-startup` runs a local HTTP
server and a persistent WebKit profile. It primes a historical cached entry,
switches the server to a new deployment with `no-cache` HTML, and evicts the old
chunk. A new page (not BFCache) using the plain URL stays blank and requests the
removed chunk **without requesting HTML**. Two launches using the production
`bootUrl` render and report success on their first navigation, before the
unchanged deadline; the second launch reuses the current cached chunk. The iOS
PR verify job runs this regression before compiling the unsigned native shell.

Local macOS WebKit results: first-navigation render/report in 29 ms and 26 ms
for the controlled cache fixture. These are not physical-iPhone latency claims.
The actual built web app mounted the phone screen in 666 ms with all tRPC
responses withheld, and tapping the unlabeled Clock face opened Alarms. At
1366×1024, tapping the Clock face and pressing Enter both opened Alarms.

Screenshots in `docs/screenshots/iphone-cold-start/` show the actual production
web bundle running locally. The local API was unavailable (phone API responses
were deliberately withheld), so data-dependent tiles show their real loading
states, not invented data. `panel.png` shows the subtitle removed; `alarms.png`
shows the detail page still reachable; `phone.png` shows the phone screen.

## Delivery boundary

The clock face is delivered by the web deployment on `home-server`. The
first-navigation change lives in the Expo shell and requires the new iOS
TestFlight build to be installed. Deploying only the web bundle cannot change
an already-installed shell's first-navigation behavior. Physical-device timing
should be checked after installing that build, especially if a delay persists
with a fresh document (DNS/connection or native startup would then need its own
device trace).
