// gifenc ships no types (v1.0.3). Declare the narrow surface booth-capture uses
// for the client-side GIF assembly: quantize a frame's RGBA to a 256-colour
// palette, map it to an indexed bitmap, and stream frames out as GIF bytes.
declare module "gifenc" {
  export type Palette = number[][];

  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number): Palette;

  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette): Uint8Array;

  export interface GifEncoderStream {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      opts?: { palette?: Palette; delay?: number },
    ): void;
    finish(): void;
    bytes(): Uint8Array;
  }

  export function GIFEncoder(): GifEncoderStream;
}
