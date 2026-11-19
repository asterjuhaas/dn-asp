import { describe, expect, it } from "vitest";
import { Screen, style } from "./screen";
import { createSprite, spriteFromText } from "./sprite";

const SYNC_OPEN = "\x1b[?2026h";
const SYNC_CLOSE = "\x1b[?2026l";

function headless(w = 10, h = 4) {
  const writes: string[] = [];
  const screen = new Screen({ w, h, write: (chunk) => writes.push(chunk) });
  return { screen, writes };
}

/** Render, then strip the synchronized-output wrapper for easier assertions. */
function renderBody(screen: Screen): string {
  const out = screen.render();
  if (!out) return "";
  expect(out.startsWith(SYNC_OPEN)).toBe(true);
  expect(out.endsWith(SYNC_CLOSE)).toBe(true);
  return out.slice(SYNC_OPEN.length, out.length - SYNC_CLOSE.length);
}

describe("style", () => {
  it("packs foreground, background and bold without collisions", () => {
    expect(style()).toBe(0);
    expect(style(9)).toBe(10);
    expect(style(undefined, 3)).toBe(4 << 9);
    expect(style(9, 3, true)).toBe(10 | (4 << 9) | (1 << 18));
  });

  it("round-trips every 256-color index", () => {
    for (let i = 0; i < 256; i++) {
      const packed = style(i);
      expect((packed & 0x1ff) - 1).toBe(i);
    }
  });
});

describe("Screen", () => {
  it("defaults to a headless buffer without touching process.stdout", () => {
    const { screen, writes } = headless(4, 2);
    expect(screen.w).toBe(4);
    expect(screen.h).toBe(2);
    expect(writes).toEqual([]);
  });

  it("paints a blank first frame, then renders nothing when unchanged", () => {
    const { screen } = headless();
    expect(renderBody(screen)).not.toBe("");
    expect(screen.render()).toBe("");
  });

  it("clips cells outside the buffer", () => {
    const { screen } = headless(3, 2);
    screen.set(-1, 0, "X");
    screen.set(3, 0, "X");
    screen.set(0, -1, "X");
    screen.set(0, 2, "X");
    expect(screen.capture().chars.every((code) => code === 32)).toBe(true);
  });

  it("writes single cells and strings", () => {
    const { screen } = headless(5, 2);
    screen.set(0, 0, "A");
    screen.text(1, 0, "BCD");
    const captured = screen.capture(0, 0, 4, 1);
    expect(
      Array.from(captured.chars)
        .map((code) => String.fromCodePoint(code))
        .join(""),
    ).toBe("ABCD");
  });

  it("does not wrap text past the right edge", () => {
    const { screen } = headless(3, 2);
    screen.text(2, 0, "ABCD");
    const row0 = String.fromCodePoint(...Array.from(screen.capture(0, 0, 3, 1).chars));
    const row1 = String.fromCodePoint(...Array.from(screen.capture(0, 1, 3, 1).chars));
    expect(row0).toBe("  A");
    expect(row1).toBe("   ");
  });

  it("emits only changed cells on the second render", () => {
    const { screen } = headless(6, 1);
    screen.text(0, 0, "HELLO");
    expect(renderBody(screen)).toContain("HELLO");
    expect(screen.render()).toBe("");
    screen.set(1, 0, "A");
    expect(renderBody(screen)).toContain("A");
  });

  it("emits a style change only when the packed style differs", () => {
    const { screen } = headless(4, 1);
    screen.text(0, 0, "AABB", style(9));
    const out = renderBody(screen);
    expect(out).toContain("38;5;9");
    // "AABB" all share one style, so it is emitted exactly once.
    expect(out.match(/38;5;9/g)).toHaveLength(1);
  });

  it("resets the style at the end of a render", () => {
    const { screen } = headless(2, 1);
    screen.text(0, 0, "A", style(9));
    renderBody(screen);
    const out = screen.render();
    expect(out).toBe("");
    screen.text(0, 0, "B", style(9));
    const next = renderBody(screen);
    // The terminal is in the default style, so the SGR must be re-sent.
    expect(next).toContain("38;5;9");
  });

  it("clears back to spaces in the default style", () => {
    const { screen } = headless(3, 1);
    screen.text(0, 0, "ABC", style(9));
    screen.clear();
    const row = Array.from(screen.capture(0, 0, 3, 1).chars).map((code) =>
      String.fromCodePoint(code),
    );
    expect(row).toEqual([" ", " ", " "]);
  });

  it("returns a clear sequence and reallocates on resize", () => {
    const { screen } = headless(4, 2);
    screen.text(0, 0, "ABCD");
    expect(screen.resize(6, 3)).toBe("\x1b[2J");
    expect(screen.w).toBe(6);
    expect(screen.h).toBe(3);
    // The diff baseline is reset, so the first render repaints everything.
    expect(renderBody(screen)).toContain("   ");
  });

  it("writes enter and leave once, to the injected sink", () => {
    const { screen, writes } = headless();
    screen.enter();
    screen.enter();
    screen.leave();
    screen.leave();
    expect(writes).toHaveLength(2);
    expect(writes[0]).toContain("\x1b[?1049h");
    expect(writes[1]).toContain("\x1b[?1049l");
  });

  it("captures a region with out-of-bounds parts transparent", () => {
    const { screen } = headless(4, 2);
    screen.text(0, 0, "AB");
    screen.text(0, 1, "CD");
    const region = screen.capture(-1, -1, 4, 4);
    expect(region.w).toBe(4);
    expect(region.h).toBe(4);
    // Row 0 and column 0 are outside the screen.
    expect(region.chars[0]).toBe(0);
    expect(String.fromCodePoint(region.chars[1 * region.w + 1])).toBe("A");
  });
});

describe("sprites on screen", () => {
  it("skips transparent cells, letting the background show", () => {
    const { screen } = headless(4, 2);
    screen.text(0, 0, "....", style(1));
    const sprite = spriteFromText(["X ", " X"]);
    screen.drawSprite(sprite, 0, 0);
    const row = Array.from(screen.capture(0, 0, 2, 1).chars).map((code) =>
      String.fromCodePoint(code),
    );
    expect(row).toEqual(["X", "."]);
  });

  it("clips sprites that hang off the screen", () => {
    const { screen } = headless(2, 2);
    screen.drawSprite(spriteFromText(["ABC", "DEF"]), -1, -1);
    const row1 = Array.from(screen.capture(0, 0, 2, 1).chars).map((code) =>
      String.fromCodePoint(code),
    );
    // Only the bottom-right 2x1 part of the sprite is visible, on the top row.
    expect(row1).toEqual(["E", "F"]);
  });

  it("applies a tint over every visible cell", () => {
    const { screen } = headless(2, 1);
    const sprite = createSprite(2, 1);
    sprite.chars.set([65, 66]);
    screen.drawSprite(sprite, 0, 0, style(11));
    const captured = screen.capture(0, 0, 2, 1);
    expect(captured.styles[0]).toBe(style(11));
    expect(captured.styles[1]).toBe(style(11));
  });
});
