/**
 * PhotoBoothDesigns / Gallery , ten distinct design prototypes for the Photo
 * Booth gallery (the view for browsing photos taken in the app), each rendered
 * at the fixed 1366x1024 wall-panel size. These are throwaway design mocks
 * built on procedural sample data (see samplePhotos.ts) , no assets, no
 * network. The user picks a direction; the winner gets built for real.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { GalleryDesign01 } from "./GalleryDesign01";
import { GalleryDesign02 } from "./GalleryDesign02";
import { GalleryDesign03 } from "./GalleryDesign03";
import { GalleryDesign04 } from "./GalleryDesign04";
import { GalleryDesign05 } from "./GalleryDesign05";
import { GalleryDesign06 } from "./GalleryDesign06";
import { GalleryDesign07 } from "./GalleryDesign07";
import { GalleryDesign08 } from "./GalleryDesign08";
import { GalleryDesign09 } from "./GalleryDesign09";
import { GalleryDesign10 } from "./GalleryDesign10";

const meta = {
  title: "PhotoBoothDesigns/Gallery",
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    // Bypass the board decorator , these mocks own the full 1366x1024 frame.
    boardWrapper: false,
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const CleanMasonry: Story = {
  name: "01 Clean Masonry",
  render: () => <GalleryDesign01 />,
};

export const PolaroidPinboard: Story = {
  name: "02 Polaroid Pinboard",
  render: () => <GalleryDesign02 />,
};

export const FilmstripReel: Story = {
  name: "03 Filmstrip Reel",
  render: () => <GalleryDesign03 />,
};

export const HeroRail: Story = {
  name: "04 Hero + Rail",
  render: () => <GalleryDesign04 />,
};

export const Timeline: Story = {
  name: "05 Timeline",
  render: () => <GalleryDesign05 />,
};

export const Cinema: Story = {
  name: "06 Cinema",
  render: () => <GalleryDesign06 />,
};

export const StickerBook: Story = {
  name: "07 Sticker Book",
  render: () => <GalleryDesign07 />,
};

export const ContactSheet: Story = {
  name: "08 Contact Sheet",
  render: () => <GalleryDesign08 />,
};

export const CardDeck: Story = {
  name: "09 Card Deck",
  render: () => <GalleryDesign09 />,
};

export const MinimalSquares: Story = {
  name: "10 Minimal Squares",
  render: () => <GalleryDesign10 />,
};

/** Empty-state variant of the Clean Masonry concept (Design 01). */
export const Empty: Story = {
  name: "Empty",
  render: () => <GalleryDesign01 photos={[]} />,
};
