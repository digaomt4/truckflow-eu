import { describe, expect, it } from 'vitest';
import {
  BASE_SALARY,
  KM_THRESHOLD,
  RATE_BONUS,
  RATE_STANDARD,
  WEEKEND_BONUS_VALUE,
  calculateMonthlyProjection,
  calculateMonthlySalary,
  calculateShiftEffectiveValues,
} from '../salaryCalculator';

describe('salaryCalculator', () => {
  it('calculates standard tier correctly up to 16.000 km', () => {
    const shifts = [
      { id: 's1', kmInicial: 1000, kmFinal: 11000, weekendOut: false },
      { id: 's2', kmInicial: 11000, kmFinal: 17000, weekendOut: true },
    ];
    const stats = calculateMonthlySalary(shifts);

    expect(stats.totalKm).toBe(16000);
    expect(stats.thresholdReached).toBe(false);
    expect(stats.activeRate).toBe(RATE_STANDARD);
    expect(stats.kmEarnings).toBe(1760);
    expect(stats.weekendEarnings).toBe(WEEKEND_BONUS_VALUE);
    expect(stats.estimatedSalary).toBe(BASE_SALARY + 1760 + 100);
  });

  it('triggers bonus rate at 16.001 km in retroactive vs tiered mode', () => {
    const shifts = [
      { id: 's1', kmInicial: 0, kmFinal: 16001, weekendOut: false },
    ];

    const retro = calculateMonthlySalary(shifts, { retroactiveBonus: true });
    expect(retro.thresholdReached).toBe(true);
    expect(retro.activeRate).toBe(RATE_BONUS);
    expect(retro.kmEarnings).toBe(1920.12);

    const tiered = calculateMonthlySalary(shifts, { retroactiveBonus: false });
    expect(tiered.thresholdReached).toBe(true);
    expect(tiered.kmEarnings).toBe(1760.12);
    expect(tiered.retroactiveDelta).toBe(160);
  });

  it('supports custom salary parameters and monthly extras', () => {
    const shifts = [
      { id: 's1', kmInicial: 0, kmFinal: 12000, weekendOut: true },
    ];
    const stats = calculateMonthlySalary(shifts, {
      baseSalary: 1500,
      kmThreshold: 10000,
      rateStandard: 0.1,
      rateBonus: 0.15,
      weekendBonusValue: 120,
      retroactiveBonus: true,
      extraWeekends: 1,
      extrasTotal: 85.5,
    });

    expect(stats.thresholdReached).toBe(true);
    expect(stats.kmEarnings).toBe(1800); // 12.000 * 0.15
    expect(stats.weekendEarnings).toBe(240); // 2 * 120
    expect(stats.extrasTotal).toBe(85.5);
    expect(stats.estimatedSalary).toBe(1500 + 1800 + 240 + 85.5);
  });

  it('matches stats.kmEarnings when summing shift effective values in tiered mode', () => {
    const shifts = [
      { id: 's3', date: '2026-11-15', kmInicial: 17000, kmFinal: 19500, status: 'completed' }, // 2.500 km
      { id: 's1', date: '2026-11-02', kmInicial: 0, kmFinal: 10000, status: 'completed' }, // 10.000 km
      { id: 's2', date: '2026-11-08', kmInicial: 10000, kmFinal: 17000, status: 'completed' }, // 7.000 km (crosses 16k!)
      { id: 'open1', date: '2026-11-20', kmInicial: 19500, kmFinal: 19500, status: 'open' },
    ];

    const stats = calculateMonthlySalary(shifts, { retroactiveBonus: false });
    const map = calculateShiftEffectiveValues(shifts, stats, {
      retroactiveBonus: false,
      kmThreshold: KM_THRESHOLD,
      rateStandard: RATE_STANDARD,
      rateBonus: RATE_BONUS,
    });

    expect(map.get('s1')).toBe(1100); // 10.000 * 0.11
    expect(map.get('s2')).toBe(780); // 6.000 * 0.11 + 1.000 * 0.12
    expect(map.get('s3')).toBe(300); // 2.500 * 0.12
    expect(map.get('open1')).toBe(0);

    const sum = Array.from(map.values()).reduce((a, b) => a + b, 0);
    expect(Math.round(sum * 100) / 100).toBe(stats.kmEarnings);
  });

  it('computes monthly pace and projection for the active month', () => {
    const shifts = [
      { id: 's1', kmInicial: 0, kmFinal: 4000, status: 'completed' },
      { id: 's2', kmInicial: 4000, kmFinal: 8000, status: 'completed' },
    ];
    const stats = calculateMonthlySalary(shifts);
    const fakeNow = new Date(2026, 10, 15); // 15 Nov 2026 (30-day month -> half elapsed)

    const proj = calculateMonthlyProjection(
      shifts,
      '2026-11',
      stats,
      { retroactiveBonus: true },
      fakeNow
    );

    expect(proj.completedShiftsCount).toBe(2);
    expect(proj.avgKmPerShift).toBe(4000);
    expect(proj.remainingDays).toBe(15);
    expect(proj.requiredKmPerDay).toBe(Math.ceil(8000 / 15));
    expect(proj.projectedTotalKm).toBe(16000);
    expect(proj.isCurrentMonth).toBe(true);
  });
});
