/**
 * Constantes oficiais da regra salarial TruckFlow EU
 */
export const BASE_SALARY = 1300; // 1.300,00 € fixo mensal
export const KM_THRESHOLD = 16000; // Gatilho exato: > 16.000 km (16.001 km ou mais)
export const RATE_STANDARD = 0.11; // 0,11 €/km até 16.000 km
export const RATE_BONUS = 0.12; // 0,12 €/km acima de 16.000 km
export const WEEKEND_BONUS_VALUE = 100; // + 100,00 € por fim de semana passado fora

function toNonNegativeNumber(val, fallback) {
  const num = Number(val);
  return Number.isFinite(num) && num >= 0 ? num : fallback;
}

function roundCents(val) {
  return Math.round((Number(val) || 0) * 100) / 100;
}

export function extractSalaryConfig(settings = {}) {
  return {
    baseSalary: toNonNegativeNumber(settings.baseSalary, BASE_SALARY),
    kmThreshold: Math.round(toNonNegativeNumber(settings.kmThreshold, KM_THRESHOLD)),
    rateStandard: toNonNegativeNumber(settings.rateStandard, RATE_STANDARD),
    rateBonus: toNonNegativeNumber(settings.rateBonus, RATE_BONUS),
    weekendBonusValue: toNonNegativeNumber(
      settings.weekendBonusValue,
      WEEKEND_BONUS_VALUE
    ),
    retroactiveBonus: settings.retroactiveBonus !== false,
  };
}

/**
 * Calcula o salário estimado e métricas de progresso para os turnos de um mês.
 */
export function calculateMonthlySalary(shifts = [], options = {}) {
  const {
    baseSalary = BASE_SALARY,
    kmThreshold = KM_THRESHOLD,
    rateStandard = RATE_STANDARD,
    rateBonus = RATE_BONUS,
    weekendBonusValue = WEEKEND_BONUS_VALUE,
    retroactiveBonus = true,
    extraWeekends = 0,
    extrasTotal = 0,
  } = options;

  const safeBase = toNonNegativeNumber(baseSalary, BASE_SALARY);
  const safeThreshold = Math.round(toNonNegativeNumber(kmThreshold, KM_THRESHOLD));
  const safeRateStandard = toNonNegativeNumber(rateStandard, RATE_STANDARD);
  const safeRateBonus = toNonNegativeNumber(rateBonus, RATE_BONUS);
  const safeWeekendBonus = toNonNegativeNumber(
    weekendBonusValue,
    WEEKEND_BONUS_VALUE
  );
  const safeExtrasTotal = roundCents(toNonNegativeNumber(extrasTotal, 0));

  let totalKm = 0;
  let shiftWeekendsCount = 0;

  for (const shift of shifts) {
    const kmInicial = Number(shift.kmInicial) || 0;
    const kmFinal = Number(shift.kmFinal) || 0;
    const distance =
      typeof shift.distanceKm === 'number'
        ? Math.max(0, shift.distanceKm)
        : Math.max(0, kmFinal - kmInicial);

    totalKm += distance;

    if (shift.weekendOut) {
      shiftWeekendsCount += 1;
    }
  }

  const safeExtraWeekends = Math.max(0, Number(extraWeekends) || 0);
  const weekendsCount = shiftWeekendsCount + safeExtraWeekends;
  const thresholdReached = totalKm > safeThreshold;

  const activeRate = thresholdReached ? safeRateBonus : safeRateStandard;

  let kmEarnings = 0;
  if (!thresholdReached) {
    kmEarnings = totalKm * safeRateStandard;
  } else if (retroactiveBonus) {
    kmEarnings = totalKm * safeRateBonus;
  } else {
    kmEarnings =
      safeThreshold * safeRateStandard +
      (totalKm - safeThreshold) * safeRateBonus;
  }

  kmEarnings = roundCents(kmEarnings);
  const weekendEarnings = roundCents(weekendsCount * safeWeekendBonus);
  const estimatedSalary = roundCents(
    safeBase + kmEarnings + weekendEarnings + safeExtrasTotal
  );

  const remainingKmForGoal = Math.max(0, safeThreshold - totalKm);
  const kmAboveGoal = Math.max(0, totalKm - safeThreshold);
  const progressPercentage =
    safeThreshold > 0
      ? Math.min(100, (totalKm / safeThreshold) * 100)
      : totalKm > 0
      ? 100
      : 0;
  const retroactiveJumpValue = roundCents(
    safeThreshold * Math.max(0, safeRateBonus - safeRateStandard)
  );

  const tieredKmEarnings = thresholdReached
    ? roundCents(
        safeThreshold * safeRateStandard +
          (totalKm - safeThreshold) * safeRateBonus
      )
    : kmEarnings;
  const fullRetroKmEarnings = thresholdReached
    ? roundCents(totalKm * safeRateBonus)
    : kmEarnings;
  const retroactiveDelta = roundCents(fullRetroKmEarnings - tieredKmEarnings);

  return {
    baseSalary: safeBase,
    totalKm,
    shiftWeekendsCount,
    extraWeekends: safeExtraWeekends,
    weekendsCount,
    threshold: safeThreshold,
    thresholdReached,
    rateStandard: safeRateStandard,
    rateBonus: safeRateBonus,
    weekendBonusValue: safeWeekendBonus,
    activeRate,
    retroactiveBonus,
    kmEarnings,
    weekendEarnings,
    extrasTotal: safeExtrasTotal,
    estimatedSalary,
    remainingKmForGoal,
    kmAboveGoal,
    progressPercentage,
    retroactiveJumpValue,
    retroactiveDelta,
  };
}

/**
 * Calcula o ganho em EUR de cada turno individualmente, respeitando o modo
 * escalonado (0,11 até a meta e 0,12 no excedente) em ordem cronológica.
 */
export function calculateShiftEffectiveValues(
  monthShifts = [],
  stats = {},
  options = {}
) {
  const result = new Map();
  const safeThreshold = Math.round(
    toNonNegativeNumber(options.kmThreshold ?? stats.threshold, KM_THRESHOLD)
  );
  const safeRateStandard = toNonNegativeNumber(
    options.rateStandard ?? stats.rateStandard,
    RATE_STANDARD
  );
  const safeRateBonus = toNonNegativeNumber(
    options.rateBonus ?? stats.rateBonus,
    RATE_BONUS
  );
  const retroactive =
    options.retroactiveBonus ?? stats.retroactiveBonus ?? true;
  const activeRate = Number.isFinite(stats.activeRate)
    ? stats.activeRate
    : stats.thresholdReached
    ? safeRateBonus
    : safeRateStandard;

  if (retroactive || !stats.thresholdReached) {
    for (const shift of monthShifts) {
      if (shift.status === 'open') {
        result.set(shift.id, 0);
        continue;
      }
      const dist =
        typeof shift.distanceKm === 'number'
          ? Math.max(0, shift.distanceKm)
          : Math.max(
              0,
              (Number(shift.kmFinal) || 0) - (Number(shift.kmInicial) || 0)
            );
      result.set(shift.id, roundCents(dist * activeRate));
    }
    return result;
  }

  const ordered = [...monthShifts].sort((a, b) => {
    const dateCmp = String(a.startDate || a.date || '').localeCompare(
      String(b.startDate || b.date || '')
    );
    if (dateCmp !== 0) return dateCmp;
    const timeCmp = String(a.startTime || '').localeCompare(
      String(b.startTime || '')
    );
    if (timeCmp !== 0) return timeCmp;
    const createdCmp = String(a.createdAt || '').localeCompare(
      String(b.createdAt || '')
    );
    if (createdCmp !== 0) return createdCmp;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });

  let runningKm = 0;
  for (const shift of ordered) {
    if (shift.status === 'open') {
      result.set(shift.id, 0);
      continue;
    }
    const dist =
      typeof shift.distanceKm === 'number'
        ? Math.max(0, shift.distanceKm)
        : Math.max(
            0,
            (Number(shift.kmFinal) || 0) - (Number(shift.kmInicial) || 0)
          );
    const before = runningKm;
    const after = runningKm + dist;
    runningKm = after;

    const standardKm = Math.max(0, Math.min(after, safeThreshold) - before);
    const bonusKm = Math.max(0, dist - standardKm);
    const value = roundCents(
      standardKm * safeRateStandard + bonusKm * safeRateBonus
    );
    result.set(shift.id, value);
  }

  return result;
}

/**
 * Calcula média de KM por turno, ritmo diário necessário e projeção do mês atual.
 */
export function calculateMonthlyProjection(
  monthShifts = [],
  selectedMonth,
  stats = {},
  salaryOptions = {},
  now = new Date()
) {
  const [yStr, mStr] = String(selectedMonth || '').split('-');
  const year = Number(yStr) || now.getFullYear();
  const month = Number(mStr) || now.getMonth() + 1;
  const daysInMonth = new Date(year, month, 0).getDate();

  const currentMonthKey = getMonthKey(now);
  const isCurrentMonth = selectedMonth === currentMonthKey;

  let elapsedDays = 0;
  let remainingDays = daysInMonth;
  if (isCurrentMonth) {
    elapsedDays = Math.max(1, now.getDate());
    remainingDays = Math.max(0, daysInMonth - elapsedDays);
  } else if (selectedMonth && selectedMonth < currentMonthKey) {
    elapsedDays = daysInMonth;
    remainingDays = 0;
  }

  let completedShiftsCount = 0;
  for (const shift of monthShifts) {
    if (shift.status === 'open') continue;
    const dist =
      typeof shift.distanceKm === 'number'
        ? Math.max(0, shift.distanceKm)
        : Math.max(
            0,
            (Number(shift.kmFinal) || 0) - (Number(shift.kmInicial) || 0)
          );
    if (dist > 0) completedShiftsCount += 1;
  }

  const totalKm = Number(stats.totalKm) || 0;
  const avgKmPerShift =
    completedShiftsCount > 0 ? Math.round(totalKm / completedShiftsCount) : 0;

  const requiredKmPerDay =
    !stats.thresholdReached && remainingDays > 0
      ? Math.ceil((Number(stats.remainingKmForGoal) || 0) / remainingDays)
      : 0;

  let projectedTotalKm = totalKm;
  let projectedSalary = Number(stats.estimatedSalary) || 0;

  if (isCurrentMonth && elapsedDays >= 1 && totalKm > 0) {
    projectedTotalKm = Math.round((totalKm / elapsedDays) * daysInMonth);
    const projectedStats = calculateMonthlySalary(
      [
        {
          kmInicial: 0,
          kmFinal: projectedTotalKm,
          distanceKm: projectedTotalKm,
          weekendOut: false,
        },
      ],
      {
        ...salaryOptions,
        extraWeekends: stats.weekendsCount ?? salaryOptions.extraWeekends ?? 0,
        extrasTotal: stats.extrasTotal ?? salaryOptions.extrasTotal ?? 0,
      }
    );
    projectedSalary = projectedStats.estimatedSalary;
  }

  return {
    completedShiftsCount,
    avgKmPerShift,
    daysInMonth,
    elapsedDays,
    remainingDays,
    requiredKmPerDay,
    projectedTotalKm,
    projectedSalary,
    isCurrentMonth,
  };
}

/**
 * Formata valores monetários no padrão europeu (ex: 3.220,12 €).
 */
export function formatEuro(value) {
  const num = Number(value) || 0;
  return new Intl.NumberFormat('pt-PT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

/**
 * Formata quilometragem com separador de milhar (ex: 16.001).
 */
export function formatKm(value) {
  const num = Math.round(Number(value) || 0);
  return new Intl.NumberFormat('pt-PT').format(num);
}

/**
 * Formata tarifa por KM (ex: 0,11 € ou 0,12 €).
 */
export function formatRate(rate) {
  return `${Number(rate).toFixed(2).replace('.', ',')} €`;
}

/**
 * Retorna a chave do mês no formato YYYY-MM a partir de um Date ou string YYYY-MM-DD.
 */
export function getMonthKey(input = new Date()) {
  if (typeof input === 'string' && input.length >= 7) {
    return input.slice(0, 7);
  }
  const d = input instanceof Date ? input : new Date(input);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Retorna string YYYY-MM-DD na timezone local para input[type="date"].
 */
export function getLocalDateISO(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Formata chave YYYY-MM para rótulo legível (ex: "Novembro 2026").
 */
export function formatMonthLabel(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(year, month - 1, 1);
  const label = new Intl.DateTimeFormat('pt-PT', {
    month: 'long',
    year: 'numeric',
  }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Avança ou retrocede meses a partir de YYYY-MM.
 */
export function shiftMonthKey(monthKey, delta) {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return getMonthKey(date);
}
