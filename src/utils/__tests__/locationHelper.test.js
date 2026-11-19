import { describe, expect, it } from 'vitest';
import {
  buildDateTimeMs,
  calculateShiftDurationLabel,
  isEndBeforeStart,
} from '../locationHelper';

describe('locationHelper', () => {
  it('builds valid epoch timestamps and detects reversed ranges', () => {
    const start = buildDateTimeMs('2026-11-10', '08:30');
    const end = buildDateTimeMs('2026-11-10', '17:45');
    expect(start).toBeTypeOf('number');
    expect(end).toBeGreaterThan(start);
    expect(isEndBeforeStart('2026-11-10', '17:45', '2026-11-10', '08:30')).toBe(
      true
    );
    expect(isEndBeforeStart('2026-11-10', '08:30', '2026-11-10', '17:45')).toBe(
      false
    );
  });

  it('formats same-day and overnight shift durations', () => {
    expect(
      calculateShiftDurationLabel('2026-11-10', '06:15', '2026-11-10', '17:40')
    ).toBe('11h 25m');
    expect(
      calculateShiftDurationLabel('2026-11-10', '21:10', '2026-11-11', '08:35')
    ).toBe('11h 25m');
    expect(
      calculateShiftDurationLabel('2026-11-11', '08:35', '2026-11-10', '21:10')
    ).toBeNull();
  });
});
