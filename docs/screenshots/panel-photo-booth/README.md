# Photo Booth and launcher order

Real native SwiftUI recordings/screenshots on the iPad Pro 13-inch simulator,
1376×1032 points. The simulator has no camera. Its camera-unavailable state is
shown honestly; the gallery's grayscale chart is the existing synthetic photo
fixture, not a live capture or a real private photo.

- `camera.png`: simple preview area, gallery button and shutter (disabled without a camera).
- `gallery.png`: booth-only gallery, extracted from the real recording.
- `detail.png`: enlarged booth photo.
- `home.png`: Calendar, Weather, Lights, Climate and Dog Walker first; Photos,
  Tesla and Wi-Fi next; Settings last.
- `photo-booth.mp4`: camera page, gallery, enlargement and chevron Back navigation.
  The shared PIN entry is outside this short clip; the test still unlocks it normally.

The app prefers the front camera, counts down three seconds, captures/normalizes
JPEG and saves to the existing booth endpoint. Camera permissions, live preview,
physical capture and rotation are not verified by a simulator recording. These
UI changes have not been published to TestFlight.

Validation: native build; upload contracts and bounds; catalog order; model-owned
save cancellation and exact-byte retry; all-app Back navigation; launcher layout;
private gallery/relock after background and reopening; all frames from a two-frame
booth burst, with wake photos excluded; native UI capture. Local Xcode 27.
