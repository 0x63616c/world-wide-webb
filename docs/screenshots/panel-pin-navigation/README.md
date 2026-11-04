# Panel access and clock motion

Real SwiftUI captures from the running iPad Pro 13-inch simulator (1376×1032
points), using the existing synthetic API transport for repeatability. No
production PIN, private photos or Wi-Fi credentials appear.

- `pin.png`: shared private-page keypad and fixed Back control.
- `clock.png`: upper-right digital time and lower-left date.
- `reveal.mp4`: paired slide-and-scale reveal, the current default.
- `depth.mp4`: scale/fade comparison.
- `dissolve.mp4`: opacity comparison.

The updated Reveal movie records a left swipe to the launcher followed by a right
swipe returning to the clock. Movies are simulator recordings exported to MP4, not
rendered mockups. Astra reviewed samples every 0.2 seconds and preferred Reveal;
the fade variants visibly overlap the large numerals and launcher labels.

The default Reveal clip includes the full-screen left swipe, the clock shrinking
and sliding left, and Home sliding in from the right while expanding, then the
same animation in reverse under a right swipe. The clock
screenshot shows the current time/date placement. Depth and Dissolve retain the
earlier comparison layout.
