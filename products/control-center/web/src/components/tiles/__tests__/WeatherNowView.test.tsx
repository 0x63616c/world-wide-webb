/**
 * WeatherNowView , pure presentational component tests.
 * No trpc mocking needed: all inputs are props.
 */
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { WeatherNowViewProps } from "../WeatherNowView";
import { WeatherNowView } from "../WeatherNowView";

afterEach(cleanup);

const populatedProps: WeatherNowViewProps = {
  status: "populated",
  temp: "72",
  cond: "Partly Cloudy",
  hi: "78",
  lo: "65",
  feels: "70",
  hum: "58",
  wind: "8",
  city: "Los Angeles",
  solarLabel: "Sunset",
  solarValue: "7:52 PM",
};

describe("WeatherNowView , loading/skeleton state", () => {
  it("renders a .tile container", () => {
    const { container } = render(<WeatherNowView status="loading" />);
    const tile = container.querySelector(".tile") as HTMLElement;
    expect(tile).toBeInTheDocument();
  });

  it("still renders the tile header so the tile is identifiable while loading", () => {
    render(<WeatherNowView status="loading" />);
    expect(screen.getByText("Weather Now")).toBeInTheDocument();
  });

  it("does not render any temperature text", () => {
    render(<WeatherNowView status="loading" />);
    expect(screen.queryByText(/°$/)).not.toBeInTheDocument();
  });
});

describe("WeatherNowView , error state", () => {
  it("renders a .tile container", () => {
    const { container } = render(<WeatherNowView status="error" />);
    const tile = container.querySelector(".tile") as HTMLElement;
    expect(tile).toBeInTheDocument();
  });

  it("still renders the tile header so the tile is identifiable in the error/retry state", () => {
    render(<WeatherNowView status="error" />);
    expect(screen.getByText("Weather Now")).toBeInTheDocument();
  });

  it("does not render any fake dash values", () => {
    render(<WeatherNowView status="error" />);
    expect(screen.queryByText("--°")).not.toBeInTheDocument();
  });
});

describe("WeatherNowView , populated state", () => {
  it("renders the tile header title", () => {
    render(<WeatherNowView {...populatedProps} />);
    expect(screen.getByText("Weather Now")).toBeInTheDocument();
  });

  it("renders the city name", () => {
    render(<WeatherNowView {...populatedProps} />);
    expect(screen.getByText("Los Angeles")).toBeInTheDocument();
  });

  it("renders the temperature with degree symbol", () => {
    render(<WeatherNowView {...populatedProps} />);
    expect(screen.getByText("72°")).toBeInTheDocument();
  });

  it("renders the condition text", () => {
    render(<WeatherNowView {...populatedProps} />);
    expect(screen.getByText("Partly Cloudy")).toBeInTheDocument();
  });

  it("renders hi and lo values", () => {
    render(<WeatherNowView {...populatedProps} />);
    expect(screen.getByText("H 78°")).toBeInTheDocument();
    expect(screen.getByText("L 65°")).toBeInTheDocument();
  });

  it("renders all metric cell labels", () => {
    render(<WeatherNowView {...populatedProps} />);
    expect(screen.getByText("Feels")).toBeInTheDocument();
    expect(screen.getByText("Humidity")).toBeInTheDocument();
    expect(screen.getByText("Wind")).toBeInTheDocument();
  });

  it("renders all metric cell values", () => {
    render(<WeatherNowView {...populatedProps} />);
    expect(screen.getByText("70°")).toBeInTheDocument();
    expect(screen.getByText("58%")).toBeInTheDocument();
    expect(screen.getByText("8 mph")).toBeInTheDocument();
  });

  it("renders the solar event label and value", () => {
    render(<WeatherNowView {...populatedProps} />);
    expect(screen.getByText("Sunset")).toBeInTheDocument();
    expect(screen.getByText("7:52 PM")).toBeInTheDocument();
  });

  it("renders Sunrise label when passed as solarLabel", () => {
    render(<WeatherNowView {...populatedProps} solarLabel="Sunrise" solarValue="5:15 AM" />);
    expect(screen.getByText("Sunrise")).toBeInTheDocument();
    expect(screen.getByText("5:15 AM")).toBeInTheDocument();
    expect(screen.queryByText("Sunset")).not.toBeInTheDocument();
  });
});

describe("WeatherNowView , populated state with partial props omitted", () => {
  it("renders without crashing when optional solar props are undefined (not populated)", () => {
    // Passing a non-populated status should show skeleton without error
    const { container } = render(<WeatherNowView status="loading" />);
    expect(container.querySelector(".tile")).toBeInTheDocument();
  });
});
