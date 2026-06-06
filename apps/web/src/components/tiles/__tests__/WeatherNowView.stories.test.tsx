/**
 * Vitest component tests for WeatherNowView stories.
 * Uses composeStories to execute each story (including play functions) in jsdom.
 */

import "@testing-library/jest-dom";
import { composeStories } from "@storybook/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as stories from "../WeatherNowView.stories";

const { Loading, ErrorState, Populated, PopulatedSunrise } = composeStories(stories);

afterEach(cleanup);

describe("WeatherNowView stories — Loading", () => {
  it("renders tile container and keeps the header visible while loading", async () => {
    const { container } = render(<Loading />);
    if (Loading.play) await Loading.play({ canvasElement: container });
    expect(container.querySelector(".tile")).toBeInTheDocument();
    expect(screen.getByText("Weather Now")).toBeInTheDocument();
  });
});

describe("WeatherNowView stories — ErrorState", () => {
  it("renders tile container, keeps the header, shows no invented values in the error state", async () => {
    const { container } = render(<ErrorState />);
    if (ErrorState.play) await ErrorState.play({ canvasElement: container });
    expect(container.querySelector(".tile")).toBeInTheDocument();
    expect(screen.getByText("Weather Now")).toBeInTheDocument();
    expect(screen.queryByText(/--°/)).not.toBeInTheDocument();
  });
});

describe("WeatherNowView stories — Populated (Sunset)", () => {
  it("renders header, city, temperature, condition, and all metric footer cells", async () => {
    const { container } = render(<Populated />);
    if (Populated.play) await Populated.play({ canvasElement: container });
    expect(screen.getByText("Weather Now")).toBeInTheDocument();
    expect(screen.getByText("Los Angeles")).toBeInTheDocument();
    expect(screen.getByText("72°")).toBeInTheDocument();
    expect(screen.getByText("Partly Cloudy")).toBeInTheDocument();
    expect(screen.getByText("H 78°")).toBeInTheDocument();
    expect(screen.getByText("L 65°")).toBeInTheDocument();
    expect(screen.getByText("Feels")).toBeInTheDocument();
    expect(screen.getByText("70°")).toBeInTheDocument();
    expect(screen.getByText("Humidity")).toBeInTheDocument();
    expect(screen.getByText("58%")).toBeInTheDocument();
    expect(screen.getByText("Wind")).toBeInTheDocument();
    expect(screen.getByText("8 mph")).toBeInTheDocument();
    expect(screen.getByText("Sunset")).toBeInTheDocument();
    expect(screen.getByText("7:52 PM")).toBeInTheDocument();
  });
});

describe("WeatherNowView stories — PopulatedSunrise", () => {
  it("renders Sunrise label and suppresses Sunset", async () => {
    const { container } = render(<PopulatedSunrise />);
    if (PopulatedSunrise.play) await PopulatedSunrise.play({ canvasElement: container });
    expect(screen.getByText("Sunrise")).toBeInTheDocument();
    expect(screen.getByText("5:15 AM")).toBeInTheDocument();
    expect(screen.queryByText("Sunset")).not.toBeInTheDocument();
    expect(screen.getByText("Weather Now")).toBeInTheDocument();
    expect(screen.getByText("72°")).toBeInTheDocument();
  });
});
