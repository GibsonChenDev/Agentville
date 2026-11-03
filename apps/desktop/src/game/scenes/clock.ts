/**
 * Wall clocks show the computer's local time. The face is part of the room
 * background; the hands are drawn on top as single pixels and redrawn when the
 * minute changes.
 */
export const CLOCK_RADIUS = 8;
const HOUR_HAND = 4;
const MINUTE_HAND = 6;

/** Pixel offsets from the clock's centre along a hand pointing `degrees` clockwise from 12. */
function hand(degrees: number, length: number): [number, number][] {
  const r = (degrees * Math.PI) / 180;
  const out: [number, number][] = [];
  for (let t = 1; t <= length; t++) {
    const p: [number, number] = [Math.round(Math.sin(r) * t) || 0, Math.round(-Math.cos(r) * t) || 0];
    if (!out.some(([x, y]) => x === p[0] && y === p[1])) out.push(p);
  }
  return out;
}

/** The pixels of both hands for a time of day. */
export function clockHands(hours: number, minutes: number): { hour: [number, number][]; minute: [number, number][] } {
  return { hour: hand(((hours % 12) + minutes / 60) * 30, HOUR_HAND), minute: hand(minutes * 6, MINUTE_HAND) };
}
