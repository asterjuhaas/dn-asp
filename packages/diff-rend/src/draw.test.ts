import { describe, expect, it } from "vitest";
import {
  box,
  centerText,
  centeredRect,
  fillRect,
  fit,
  hline,
  textWidth,
  truncate,
  vline,
} from "./draw";
import { Screen } from "./screen";

function headless(w: number, h: number) {
  return new Screen({ w, h, write: () => {} });
}

function rows(screen: Screen, w: number, h: number): string[] {
  const out: string[] = [];
  for (let y = 0; y < h; y++) {
    const region = screen.capture(0, y, w, 1);
    out.push(
      Array.from(region.chars)
        .map((code) => String.fromCodePoint(code))
        .join(""),
    );
  }
  return out;
}

describe("layout helpers", () => {
  it("fills a rectangle", () => {
    const screen = headless(6, 3);
    fillRect(screen, 1, 1, 3, 1, "=");
    expect(rows(screen, 6, 3)[1]).toBe(" ===  ");
  });

  it("draws horizontal and vertical lines", () => {
    const screen = headless(5, 4);
    hline(screen, 0, 0, 5, "-");
    vline(screen, 2, 0, 4, "|");
    expect(rows(screen, 5, 4)).toEqual(["--|--", "  |  ", "  |  ", "  |  "]);
  });

  it("draws an ASCII box with exact bounds", () => {
    const screen = headless(6, 4);
    box(screen, 0, 0, 6, 4);
    expect(rows(screen, 6, 4)).toEqual(["+----+", "|    |", "|    |", "+----+"]);
  });

  it("ignores boxes that are too small to close", () => {
    const screen = headless(2, 2);
    box(screen, 0, 0, 1, 1);
    expect(rows(screen, 2, 2)).toEqual(["+ ", "  "]);
  });

  it("centers a rectangle with the extra cell on the right and bottom", () => {
    expect(centeredRect(80, 30, 60, 22)).toEqual({ x: 10, y: 4, w: 60, h: 22 });
    expect(centeredRect(81, 31, 60, 22)).toEqual({ x: 10, y: 4, w: 60, h: 22 });
    expect(centeredRect(21, 11, 20, 10)).toEqual({ x: 0, y: 0, w: 20, h: 10 });
  });

  it("centers text inside a region", () => {
    const screen = headless(10, 1);
    centerText(screen, 0, 0, 10, "HI");
    expect(rows(screen, 10, 1)[0]).toBe("    HI    ");
  });

  it("truncates with an ellipsis and never splits code points", () => {
    expect(textWidth("abc")).toBe(3);
    expect(truncate("abcdef", 6)).toBe("abcdef");
    expect(truncate("abcdef", 5)).toBe("ab...");
    expect(truncate("abcdef", 3)).toBe("abc");
    expect(truncate("abcdef", 0)).toBe("");
    expect(truncate("a\u{1f600}b", 2)).toBe("a\u{1f600}");
  });

  it("fits text to an exact width with three alignments", () => {
    expect(fit("ab", 5)).toBe("ab   ");
    expect(fit("ab", 5, "right")).toBe("   ab");
    expect(fit("ab", 5, "center")).toBe(" ab  ");
    expect(fit("abcdef", 5, "center")).toBe("ab...");
  });
});
