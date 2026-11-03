import { describe, expect, it } from 'vitest';
import { CLOCK_RADIUS, clockHands } from './clock';
import { DEFAULT_SCENES, lobbyScene } from './layouts';

describe('wall clock', () => {
  it('points the hands at the time', () => {
    const noon = clockHands(12, 0);
    expect(noon.minute.at(-1)).toEqual([0, -6]); // straight up
    expect(noon.hour.at(-1)).toEqual([0, -4]);
    const three = clockHands(15, 0);
    expect(three.hour.at(-1)).toEqual([4, 0]); // 3 o'clock: right
    const halfSix = clockHands(18, 30);
    expect(halfSix.minute.at(-1)).toEqual([0, 6]); // :30 straight down
    expect(halfSix.hour.at(-1)![1]).toBeGreaterThan(0); // hour hand between 6 and 7: below the centre
    expect(halfSix.hour.at(-1)![0]).toBeLessThan(0); // …and to the left
  });

  it('keeps the hands inside the face', () => {
    for (let h = 0; h < 24; h++)
      for (let m = 0; m < 60; m += 7)
        for (const [x, y] of [...clockHands(h, m).hour, ...clockHands(h, m).minute]) expect(Math.hypot(x, y)).toBeLessThan(CLOCK_RADIUS - 1);
  });

  it('every map and the lobby has a clock on the wall', () => {
    for (const scene of [...Object.values(DEFAULT_SCENES), lobbyScene([{ id: 'personal', plate: '#fff' }, { id: 'new', plate: '#fff' }])])
      expect(scene.wallDecor.filter((d) => d.kind === 'clock'), scene.theme).toHaveLength(1);
  });
});
