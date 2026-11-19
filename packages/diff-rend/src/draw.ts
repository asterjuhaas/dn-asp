import type { Screen } from "./screen";

/** Fill a rectangle with a single character. Clipped to the screen automatically. */
export function fillRect(
  screen: Screen,
  x: number,
  y: number,
  w: number,
  h: number,
  ch = " ",
  st = 0,
): void {
  for (let dy = 0; dy < h; dy++) screen.text(x, y + dy, ch.repeat(Math.max(0, w)), st);
}

/** Draw a horizontal line of `len` cells starting at `(x, y)`. */
export function hline(screen: Screen, x: number, y: number, len: number, ch = "-", st = 0): void {
  screen.text(x, y, ch.repeat(Math.max(0, len)), st);
}

/** Draw a vertical line of `len` cells starting at `(x, y)`. */
export function vline(screen: Screen, x: number, y: number, len: number, ch = "|", st = 0): void {
  for (let dy = 0; dy < len; dy++) screen.set(x, y + dy, ch, st);
}

/** Options for {@link box}. All glyphs default to plain ASCII. */
export interface BoxOptions {
  /** Packed style from `style()`. */
  style?: number;
  horizontal?: string;
  vertical?: string;
  corner?: string;
}

/**
 * Draw an ASCII box outline.
 *
 * The box occupies exactly `w * h` cells: the corners are at `(x, y)`,
 * `(x + w - 1, y)`, `(x, y + h - 1)` and `(x + w - 1, y + h - 1)`.
 */
export function box(
  screen: Screen,
  x: number,
  y: number,
  w: number,
  h: number,
  options: BoxOptions = {},
): void {
  if (w <= 0 || h <= 0) return;
  const st = options.style ?? 0;
  const horizontal = options.horizontal ?? "-";
  const vertical = options.vertical ?? "|";
  const corner = options.corner ?? "+";

  hline(screen, x + 1, y, w - 2, horizontal, st);
  hline(screen, x + 1, y + h - 1, w - 2, horizontal, st);
  vline(screen, x, y + 1, h - 2, vertical, st);
  vline(screen, x + w - 1, y + 1, h - 2, vertical, st);
  screen.set(x, y, corner, st);
  screen.set(x + w - 1, y, corner, st);
  screen.set(x, y + h - 1, corner, st);
  screen.set(x + w - 1, y + h - 1, corner, st);
}

/** Number of terminal cells used by `text`. The engine only supports narrow cells, so this is code point count. */
export function textWidth(text: string): number {
  return Array.from(text).length;
}

/**
 * Truncate `text` to at most `max` cells, appending `...` when it was cut.
 *
 * `max < 3` simply returns the first `max` characters. Iteration is by code
 * point, so surrogate pairs are never split.
 */
export function truncate(text: string, max: number): string {
  if (max <= 0) return "";
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  if (max <= 3) return chars.slice(0, max).join("");
  return chars.slice(0, max - 3).join("") + "...";
}

/**
 * Truncate or pad `text` to exactly `width` cells.
 *
 * `align` decides where the padding goes when the text is shorter than the
 * width. Text longer than `width` is truncated with `truncate`.
 */
export function fit(
  text: string,
  width: number,
  align: "left" | "center" | "right" = "left",
): string {
  const clipped = truncate(text, width);
  const pad = " ".repeat(Math.max(0, width - textWidth(clipped)));
  if (align === "right") return pad + clipped;
  if (align === "center") {
    const left = Math.floor(pad.length / 2);
    return pad.slice(0, left) + clipped + pad.slice(left);
  }
  return clipped + pad;
}

/** Draw `text` centered horizontally in a `width`-cell region starting at column `x`. */
export function centerText(
  screen: Screen,
  x: number,
  y: number,
  width: number,
  text: string,
  st = 0,
): void {
  const clipped = truncate(text, width);
  const left = x + Math.floor((width - textWidth(clipped)) / 2);
  screen.text(left, y, clipped, st);
}

/** A rectangle returned by {@link centeredRect}. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Center a `w * h` rectangle inside a `containerW * containerH` area.
 *
 * Coordinates are floored, so the extra odd cell always goes to the right and
 * bottom. Negative results mean the rectangle is larger than the container.
 */
export function centeredRect(containerW: number, containerH: number, w: number, h: number): Rect {
  return {
    x: Math.floor((containerW - w) / 2),
    y: Math.floor((containerH - h) / 2),
    w,
    h,
  };
}
