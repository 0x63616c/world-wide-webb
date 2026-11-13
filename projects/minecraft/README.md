# Minecraft Tuner

A client-only Fabric mod for Minecraft Java 26.3. It adds a **Wheel & HUD Tuner** button to Mouse Settings and Video Settings.

- Reverse the vertical wheel direction in Minecraft.
- Adjust Minecraft's native scroll sensitivity and discrete scrolling while testing a nine-slot hotbar in the same screen. The preview uses the game's scroll accumulator, so fractional wheel events can combine into one slot change.
- Shift Jade's look-at tooltip and vanilla boss bars down by a configurable number of GUI pixels. The settings screen previews the offset at the screen's actual top center. Jade is optional; its position is updated through Jade's own config API when installed.

Settings save in `config/minecraft-tuner.json` and Minecraft's `options.txt`. The offset is in scaled GUI pixels, so it stays the same size when the display resolution changes.

## Build

Use Java 25 and run `./gradlew build`. Install `build/libs/minecraft-tuner-0.1.0.jar` in the Fabric instance's `mods` folder. Fabric API is required. Jade is optional.

## Limits

This controls Jade and vanilla boss bars. Other mods that draw at the top center need their own API or render hook; a blanket shift of everything in that screen region would also move unrelated UI.

## License

CC0 1.0. See `LICENSE`.
