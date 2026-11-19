import { describe, expect, it } from "vitest";
import { createSprite, spriteFromText } from "./sprite";
import { style } from "./screen";

function asText(sprite: ReturnType<typeof createSprite>): string[] {
  const lines: string[] = [];
  for (let y = 0; y < sprite.h; y++) {
    let line = "";
    for (let x = 0; x < sprite.w; x++) {
      const code = sprite.chars[y * sprite.w + x]!;
      line += code === 0 ? " " : String.fromCodePoint(code);
    }
    lines.push(line);
  }
  return lines;
}

describe("createSprite", () => {
  it("starts fully transparent", () => {
    const sprite = createSprite(3, 2);
    expect(sprite.w).toBe(3);
    expect(sprite.h).toBe(2);
    expect(Array.from(sprite.chars)).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe("spriteFromText", () => {
  it("parses multi-line art and pads shorter lines", () => {
    const sprite = spriteFromText(["ABC", "DE"]);
    expect(sprite.w).toBe(3);
    expect(sprite.h).toBe(2);
    expect(asText(sprite)).toEqual(["ABC", "DE "]);
  });

  it("drops a leading blank line and a trailing whitespace-only line", () => {
    const sprite = spriteFromText("\nAB\nCD\n   ");
    expect(asText(sprite)).toEqual(["AB", "CD"]);
  });

  it("treats spaces as transparent by default", () => {
    const sprite = spriteFromText(["A B"]);
    expect(sprite.chars[1]).toBe(0);
  });

  it("makes spaces opaque when transparent is empty", () => {
    const sprite = spriteFromText(["A B"], { transparent: "" });
    expect(sprite.chars[1]).toBe(32);
  });

  it("maps palette colors by matching the art shape", () => {
    const sprite = spriteFromText(["AB", "AB"], {
      colors: ["rr", "gg"],
      palette: { r: style(9), g: style(10) },
    });
    expect(sprite.styles[0]).toBe(style(9));
    expect(sprite.styles[2]).toBe(style(10));
  });

  it("falls back to the base style for unknown color keys", () => {
    const sprite = spriteFromText(["A"], {
      style: style(14),
      colors: ["z"],
      palette: { r: style(9) },
    });
    expect(sprite.styles[0]).toBe(style(14));
  });
});
