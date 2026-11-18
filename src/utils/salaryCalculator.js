/**
 * Constantes oficiais da regra salarial TruckFlow EU
 */
export const BASE_SALARY = 1300; // 1.300,00 € fixo mensal
export const KM_THRESHOLD = 16000; // Gatilho exato: > 16.000 km (16.001 km ou mais)
export const RATE_STANDARD = 0.11; // 0,11 €/km até 16.000 km
export const RATE_BONUS = 0.12; // 0,12 €/km acima de 16.000 km
export const WEEKEND_BONUS_VALUE = 100; // + 100,00 € por fim de semana passado fora

/**
 * Calcula o salário estimado e métricas de progresso para os turnos de um mês.
 *
 * Fórmula:
 *   Salário Estimado = 1300 + KM_Earnings + (Qtd_Fins_De_Semana * 100)
 *
 * Regra de Gatilho:
 *   - Se Total_KM <= 16.000: todos os km * 0,11 €
 *   - Se Total_KM > 16.000 (16.001+):
 *       - Com retroactiveBonus = true (padrão): todos os km * 0,12 €
 *       - Com retroactiveBonus = false (escalonado): (16.000 * 0,11 €) + ((Total_KM - 16.000) * 0,12 €)
 */
export function calculateMonthlySalary(shifts = [], options = {}) {
  const {
    retroactiveBonus = true,
    extraWeekends = 0,
  } = options;

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
  const thresholdReached = totalKm > KM_THRESHOLD;

  const activeRate = thresholdReached ? RATE_BONUS : RATE_STANDARD;

  let kmEarnings = 0;
  if (!thresholdReached) {
    kmEarnings = totalKm * RATE_STANDARD;
  } else if (retroactiveBonus) {
    kmEarnings = totalKm * RATE_BONUS;
  } else {
    kmEarnings =
      KM_THRESHOLD * RATE_STANDARD +
      (totalKm - KM_THRESHOLD) * RATE_BONUS;
  }

  // Arredondamento para 2 casas decimais evitando ruído de ponto flutuante
  kmEarnings = Math.round(kmEarnings * 100) / 100;
  const weekendEarnings = weekendsCount * WEEKEND_BONUS_VALUE;
  const estimatedSalary =
    Math.round((BASE_SALARY + kmEarnings + weekendEarnings) * 100) / 100;

  const remainingKmForGoal = Math.max(0, KM_THRESHOLD - totalKm);
  const kmAboveGoal = Math.max(0, totalKm - KM_THRESHOLD);
  const progressPercentage = Math.min(100, (totalKm / KM_THRESHOLD) * 100);
  const retroactiveJumpValue =
    Math.round(KM_THRESHOLD * (RATE_BONUS - RATE_STANDARD) * 100) / 100; // 160,00 €

  // Quanto o modo retroativo rende a mais que o escalonado quando > 16.000 km
  const tieredKmEarnings = thresholdReached
    ? Math.round(
        (KM_THRESHOLD * RATE_STANDARD + (totalKm - KM_THRESHOLD) * RATE_BONUS) *
          100
      ) / 100
    : kmEarnings;
  const fullRetroKmEarnings = thresholdReached
    ? Math.round(totalKm * RATE_BONUS * 100) / 100
    : kmEarnings;
  const retroactiveDelta =
    Math.round((fullRetroKmEarnings - tieredKmEarnings) * 100) / 100;

  return {
    baseSalary: BASE_SALARY,
    totalKm,
    shiftWeekendsCount,
    extraWeekends: safeExtraWeekends,
    weekendsCount,
    threshold: KM_THRESHOLD,
    thresholdReached,
    activeRate,
    retroactiveBonus,
    kmEarnings,
    weekendEarnings,
    estimatedSalary,
    remainingKmForGoal,
    kmAboveGoal,
    progressPercentage,
    retroactiveJumpValue,
    retroactiveDelta,
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
