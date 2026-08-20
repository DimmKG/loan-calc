import {
  addMonths,
  addYears,
  differenceInCalendarDays,
  differenceInMonths,
  getDaysInMonth,
  isLeapYear,
  isSameDay,
  isWeekend,
  nextMonday,
  startOfYear,
} from "date-fns";

export type LoanType = "ANNUITY" | "AMORTIZATION";
export type DayCountBasis = "ACTUAL_365" | "ACTUAL_360" | "ACTUAL_ACTUAL";

export function roundDecimals(value: number, decimals: number): number {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

export function getMonthDaysAndYearDays(
  paymentDate: Date,
  dayCountBasis: DayCountBasis
): { daysInYear: number; daysInMonth: number } {
  let daysInYear = 360;
  let daysInMonth = 30;
  if (dayCountBasis === "ACTUAL_365") {
    daysInYear = 365;
    daysInMonth = getDaysInMonth(paymentDate);
    if (daysInMonth === 29) {
      daysInMonth = 28;
    }
  }
  if (dayCountBasis === "ACTUAL_ACTUAL") {
    daysInYear = isLeapYear(paymentDate) ? 366 : 365;
    daysInMonth = getDaysInMonth(paymentDate);
  }
  return { daysInYear, daysInMonth };
}

export function calculateAnnuityMonthlyPayment(dto: {
  principal: number;
  monthlyInterestRate: number;
  termMonths: number;
  roundingDecimals: number;
}): number {
  const { principal, monthlyInterestRate, termMonths, roundingDecimals } = dto;
  const result = roundDecimals(
    (principal *
      monthlyInterestRate *
      Math.pow(1 + monthlyInterestRate, termMonths)) /
      (Math.pow(1 + monthlyInterestRate, termMonths) - 1),
    roundingDecimals
  );
  return result;
}

/**
 * Вычисляет количество месяцев, на которое уменьшается срок кредита
 * при досрочном погашении указанной суммы основного долга (аннуитет).
 *
 * Формула: вычисляем разницу между сроком до и после досрочного платежа.
 * n_before = -log(1 - remainingPrincipal * r / A) / log(1 + r)
 * n_after = -log(1 - (remainingPrincipal - principalAmountPaid) * r / A) / log(1 + r)
 * monthsReduction = n_before - n_after
 */
export function calculateMonthsReduction(
  principalAmountPaid: number,
  remainingPrincipal: number,
  monthlyInterestRate: number,
  annuityMonthlyPayment: number
): number {
  if (principalAmountPaid <= 0 || remainingPrincipal <= 0) {
    return 0;
  }

  if (monthlyInterestRate <= 0 || annuityMonthlyPayment <= 0) {
    return 0;
  }

  const ratioBefore =
    (remainingPrincipal * monthlyInterestRate) / annuityMonthlyPayment;
  if (ratioBefore >= 1 || ratioBefore <= 0) {
    return 0;
  }
  const monthsBefore =
    -Math.log(1 - ratioBefore) / Math.log(1 + monthlyInterestRate);

  const remainingPrincipalAfter = remainingPrincipal - principalAmountPaid;
  if (remainingPrincipalAfter <= 0) {
    return Math.ceil(monthsBefore);
  }

  const ratioAfter =
    (remainingPrincipalAfter * monthlyInterestRate) / annuityMonthlyPayment;
  if (ratioAfter >= 1 || ratioAfter <= 0) {
    return 0;
  }
  const monthsAfter =
    -Math.log(1 - ratioAfter) / Math.log(1 + monthlyInterestRate);

  const monthsReduction = monthsBefore - monthsAfter;
  return Math.max(0, Math.floor(monthsReduction));
}

/**
 * Вычисляет количество месяцев, на которое уменьшается срок кредита
 * при досрочном погашении указанной суммы основного долга
 * (дифференцированный платёж — фиксированное тело долга за период).
 */
export function calculateAmortizationMonthsReduction(params: {
  principalAmountPaid: number;
  remainingPrincipal: number;
  amortizationPrincipal: number;
}): number {
  const { principalAmountPaid, remainingPrincipal, amortizationPrincipal } =
    params;

  if (
    principalAmountPaid <= 0 ||
    remainingPrincipal <= 0 ||
    amortizationPrincipal <= 0
  ) {
    return 0;
  }

  const periodsBefore = Math.ceil(remainingPrincipal / amortizationPrincipal);
  const remainingPrincipalAfter = remainingPrincipal - principalAmountPaid;
  if (remainingPrincipalAfter <= 0) {
    return periodsBefore;
  }
  const periodsAfter = Math.ceil(
    remainingPrincipalAfter / amortizationPrincipal
  );

  return Math.max(0, periodsBefore - periodsAfter);
}

/**
 * Разбивает полуоткрытый интервал [fromDate, toDate) на сегменты по
 * календарным годам: для ACTUAL_ACTUAL дни до и после границы 31
 * декабря/1 января относятся к разным годам и должны делиться на
 * дни-в-году (365/366) СВОЕГО года, а не одного числа на весь период.
 */
function splitDateRangeByCalendarYear(
  fromDate: Date,
  toDate: Date
): { start: Date; end: Date; daysInYear: number }[] {
  const segments: { start: Date; end: Date; daysInYear: number }[] = [];
  let segmentStart = fromDate;
  while (segmentStart < toDate) {
    const nextYearStart = startOfYear(addYears(segmentStart, 1));
    const segmentEnd = nextYearStart < toDate ? nextYearStart : toDate;
    segments.push({
      start: segmentStart,
      end: segmentEnd,
      daysInYear: isLeapYear(segmentStart) ? 366 : 365,
    });
    segmentStart = segmentEnd;
  }
  return segments;
}

/**
 * Начисленные простые проценты за фактическое число дней между датами, по
 * выбранной базе расчёта (дней в году/месяце) - БЕЗ округления результата.
 * Используется там, где промежуточное округление недопустимо (например,
 * при подборе платежа по многим периодам подряд - округление ставки до
 * копеек на каждом шаге разрушило бы точность). Публичная
 * calculateAccruedInterest ниже - тонкая округляющая обёртка над этой же
 * логикой.
 */
function accruedInterestRaw(
  principal: number,
  annualInterestRatePercent: number,
  dayCountBasis: DayCountBasis,
  fromDate: Date,
  toDate: Date
): number {
  if (dayCountBasis === "ACTUAL_ACTUAL") {
    const segments = splitDateRangeByCalendarYear(fromDate, toDate);
    return segments.reduce((sum, segment) => {
      const days = differenceInCalendarDays(segment.end, segment.start);
      return (
        sum +
        principal *
          (annualInterestRatePercent / 100 / segment.daysInYear) *
          days
      );
    }, 0);
  }

  const dayDifference = differenceInCalendarDays(toDate, fromDate);
  const { daysInYear } = getMonthDaysAndYearDays(toDate, dayCountBasis);

  return principal * (annualInterestRatePercent / 100 / daysInYear) * dayDifference;
}

/**
 * Начисленные простые проценты за фактическое число дней между датами,
 * по выбранной базе расчёта (дней в году/месяце).
 */
export function calculateAccruedInterest(params: {
  principal: number;
  annualInterestRatePercent: number;
  dayCountBasis: DayCountBasis;
  fromDate: Date;
  toDate: Date;
  roundingDecimals: number;
}): number {
  const {
    principal,
    annualInterestRatePercent,
    dayCountBasis,
    fromDate,
    toDate,
    roundingDecimals,
  } = params;

  return roundDecimals(
    accruedInterestRaw(principal, annualInterestRatePercent, dayCountBasis, fromDate, toDate),
    roundingDecimals
  );
}

/**
 * Считает фиксированный аннуитетный платёж методом goal-seek: моделирует
 * реальную последовательность будущих дат платежей (с тем же переносом
 * выходных, что и основной цикл графика) и реальные проценты по каждому
 * периоду (факт дней, без промежуточного округления), затем подбирает
 * платёж, при котором остаток долга обнуляется ровно после termMonths
 * периодов. В отличие от closed-form calculateAnnuityMonthlyPayment
 * (номинальная ставка rate/12 на все периоды одинаково), здесь у каждого
 * периода своя реальная ставка - что и обеспечивает точное совпадение с
 * тем, как считают реальные банки (см. обоснование в плане/контексте сессии).
 */
export function calculateAnnuityPaymentForSchedule(params: {
  principal: number;
  annualInterestRatePercent: number;
  dayCountBasis: DayCountBasis;
  startDate: Date;
  paymentDayNumber: number;
  moveHolidayToNextDay: boolean;
  termMonths: number;
  roundingDecimals: number;
  /**
   * Сколько ближайших периодов моделировать точно (реальные даты, реальные
   * дни, перенос выходных). Периоды после этого горизонта используют
   * номинальную месячную ставку (rate/12) как приближение. По умолчанию
   * (undefined) - точное моделирование всего срока целиком.
   */
  horizonMonths?: number;
}): number {
  const {
    principal,
    annualInterestRatePercent,
    dayCountBasis,
    startDate,
    paymentDayNumber,
    moveHolidayToNextDay,
    termMonths,
    roundingDecimals,
    horizonMonths,
  } = params;

  const preciseCount = Math.min(termMonths, horizonMonths ?? termMonths);
  const flatMonthlyRate = annualInterestRatePercent / 12 / 100;

  let periodStart = startDate;
  const rates: number[] = [];
  for (let i = 0; i < termMonths; i++) {
    if (i < preciseCount) {
      const periodEnd = moveToNextDate(periodStart, paymentDayNumber, moveHolidayToNextDay);
      rates.push(
        accruedInterestRaw(1, annualInterestRatePercent, dayCountBasis, periodStart, periodEnd)
      );
      periodStart = periodEnd;
    } else {
      rates.push(flatMonthlyRate);
    }
  }

  // Замкнутая форма для аннуитета с переменной по периодам ставкой:
  // payment = P * Π(1+r_k) / Σ_{k=1}^{N} Π_{j=k+1}^{N}(1+r_j)
  const suffix: number[] = new Array(termMonths + 1);
  suffix[termMonths] = 1;
  for (let k = termMonths - 1; k >= 0; k--) {
    suffix[k] = suffix[k + 1] * (1 + rates[k]);
  }
  let denom = 0;
  for (let k = 0; k < termMonths; k++) {
    denom += suffix[k + 1];
  }
  return roundDecimals((principal * suffix[0]) / denom, roundingDecimals);
}

/**
 * Разбивает сумму досрочного платежа на проценты и тело долга.
 * Если суммы не хватает даже на начисленные проценты — весь платёж
 * уходит в проценты, а недостача переносится на следующий регулярный платёж
 * (remainingInterestCarryover). Переплата сверх остатка долга клэмпится.
 */
export function splitEarlyRepaymentAmount(params: {
  earlyRepaymentAmount: number;
  accruedInterest: number;
  remainingPrincipal: number;
  roundingDecimals: number;
}): {
  interestPaid: number;
  principalPaid: number;
  remainingPrincipalAfter: number;
  remainingInterestCarryover: number;
  actualPaymentAmount: number;
} {
  const { earlyRepaymentAmount, accruedInterest, remainingPrincipal, roundingDecimals } =
    params;

  if (earlyRepaymentAmount <= accruedInterest) {
    return {
      interestPaid: earlyRepaymentAmount,
      principalPaid: 0,
      remainingPrincipalAfter: remainingPrincipal,
      remainingInterestCarryover: roundDecimals(
        accruedInterest - earlyRepaymentAmount,
        roundingDecimals
      ),
      actualPaymentAmount: earlyRepaymentAmount,
    };
  }

  let principalPaid = roundDecimals(
    earlyRepaymentAmount - accruedInterest,
    roundingDecimals
  );
  let remainingPrincipalAfter = roundDecimals(
    remainingPrincipal - principalPaid,
    roundingDecimals
  );
  let actualPaymentAmount = earlyRepaymentAmount;

  if (remainingPrincipalAfter < 0) {
    principalPaid = principalPaid + remainingPrincipalAfter;
    actualPaymentAmount = actualPaymentAmount + remainingPrincipalAfter;
    remainingPrincipalAfter = 0;
  }

  return {
    interestPaid: accruedInterest,
    principalPaid,
    remainingPrincipalAfter,
    remainingInterestCarryover: 0,
    actualPaymentAmount,
  };
}

/**
 * Считает сумму платежа и тела долга для обычного (не досрочного) платежа.
 */
export function buildRegularPaymentEntry(params: {
  loanType: LoanType;
  interestAmount: number;
  remainingPrincipal: number;
  annuityMonthlyPayment: number;
  amortizationPrincipal: number;
  roundingDecimals: number;
}): { principalAmount: number; paymentAmount: number; remainingPrincipalAfter: number } {
  const {
    loanType,
    interestAmount,
    remainingPrincipal,
    annuityMonthlyPayment,
    amortizationPrincipal,
    roundingDecimals,
  } = params;

  if (loanType === "ANNUITY") {
    const principalAmount = roundDecimals(
      annuityMonthlyPayment - interestAmount,
      roundingDecimals
    );
    const remainingPrincipalAfter = roundDecimals(
      remainingPrincipal - principalAmount,
      roundingDecimals
    );
    return {
      principalAmount,
      paymentAmount: annuityMonthlyPayment,
      remainingPrincipalAfter,
    };
  }

  const remainingPrincipalAfter = roundDecimals(
    remainingPrincipal - amortizationPrincipal,
    roundingDecimals
  );
  const paymentAmount = roundDecimals(
    amortizationPrincipal + interestAmount,
    roundingDecimals
  );
  return {
    principalAmount: amortizationPrincipal,
    paymentAmount,
    remainingPrincipalAfter,
  };
}

/**
 * Пересчитывает аннуитетный платёж после частичного досрочного погашения
 * (репаймент типа DECREASE_PAYMENT) — по явно переданному числу оставшихся
 * периодов, чтобы вызывающая сторона не могла случайно передать
 * не пересчитанный на момент вызова счётчик.
 */
export function recalculateAnnuityPaymentAfterPrepayment(params: {
  remainingPrincipal: number;
  monthlyInterestRate: number;
  periodsRemaining: number;
  roundingDecimals: number;
}): number {
  const { remainingPrincipal, monthlyInterestRate, periodsRemaining, roundingDecimals } =
    params;
  return calculateAnnuityMonthlyPayment({
    principal: remainingPrincipal,
    monthlyInterestRate,
    termMonths: periodsRemaining,
    roundingDecimals,
  });
}

/**
 * Пересчитывает размер тела долга за период для дифференцированного платежа
 * после частичного досрочного погашения, по явно переданному числу
 * оставшихся периодов.
 */
export function recalculateAmortizationPrincipal(params: {
  remainingPrincipal: number;
  periodsRemaining: number;
  roundingDecimals: number;
}): number {
  const { remainingPrincipal, periodsRemaining, roundingDecimals } = params;
  if (periodsRemaining <= 0) {
    return roundDecimals(remainingPrincipal, roundingDecimals);
  }
  return roundDecimals(remainingPrincipal / periodsRemaining, roundingDecimals);
}

export function calculateMonthFromIssueDate(
  paymentDate: Date,
  issueDate: Date
): number {
  return differenceInMonths(paymentDate, issueDate) + 1;
}

/**
 * Вычисляет правильный номер месяца для платежа.
 *
 * Для регулярных платежей:
 * - Если день платежа совпадает с paymentDayNumber, номер = разница месяцев от даты выдачи + 1
 * - Иначе используется текущий счетчик месяца
 *
 * Для досрочных платежей:
 * - Если происходит в тот же день, что и регулярный платеж - используется номер регулярного платежа
 * - Иначе вычисляется номер месяца для даты досрочного платежа от даты выдачи
 */
export function calculateMonthNumber(
  paymentDate: Date,
  isEarlyRepayment: boolean,
  currentMonthNumber: number,
  issueDate: Date,
  paymentDayNumber: number,
  nextRegularDate?: Date
): number {
  if (isEarlyRepayment) {
    if (!nextRegularDate) {
      return currentMonthNumber;
    }

    if (isSameDay(paymentDate, nextRegularDate)) {
      return calculateMonthNumber(
        nextRegularDate,
        false,
        currentMonthNumber,
        issueDate,
        paymentDayNumber
      );
    }

    return calculateMonthFromIssueDate(paymentDate, issueDate);
  }

  if (paymentDate.getDate() === paymentDayNumber) {
    return calculateMonthFromIssueDate(paymentDate, issueDate);
  }

  return currentMonthNumber;
}

export function moveToNextDate(
  currentDate: Date,
  paymentDayNumber: number,
  moveHolidayToNextDay: boolean
): Date {
  let nextDate = new Date(currentDate);
  const paymentDay = currentDate.getDate();
  if (paymentDay !== paymentDayNumber) {
    nextDate.setDate(paymentDayNumber);
  }
  nextDate = addMonths(nextDate, 1);
  nextDate.setHours(0, 0, 0, 0);
  if (moveHolidayToNextDay) {
    if (isWeekend(nextDate)) {
      nextDate = nextMonday(nextDate);
    }
  }
  return nextDate;
}

/**
 * Выравнивает дату под правило регулярного платежа (день месяца +
 * перенос выходных), без добавления месяца. Используется для досрочных
 * погашений с флагом syncWithPaymentDate: гарантирует, что дата досрочного
 * платежа совпадает с фактической (в т.ч. перенесённой из-за выходного)
 * датой регулярного платежа, а не "уезжает" от неё из-за независимого
 * подсчёта календарных месяцев.
 */
export function alignToPaymentDate(
  date: Date,
  paymentDayNumber: number,
  moveHolidayToNextDay: boolean
): Date {
  let aligned = new Date(date);
  if (aligned.getDate() !== paymentDayNumber) {
    aligned.setDate(paymentDayNumber);
  }
  aligned.setHours(0, 0, 0, 0);
  if (moveHolidayToNextDay && isWeekend(aligned)) {
    aligned = nextMonday(aligned);
  }
  return aligned;
}

/**
 * Продвигает дату досрочного погашения, синхронизированного с датой
 * регулярного платежа, на N периодов вперёд (1 для MONTHLY, 3 для
 * QUARTERLY, 12 для YEARLY), применяя на каждом шаге то же правило
 * переноса выходных, что и обычный график платежей — благодаря этому
 * результат всегда точно совпадает с реальной датой соответствующего
 * будущего регулярного платежа.
 */
export function advanceSyncedEarlyRepaymentDate(
  date: Date,
  monthsPerOccurrence: number,
  paymentDayNumber: number,
  moveHolidayToNextDay: boolean
): Date {
  let next = date;
  for (let i = 0; i < monthsPerOccurrence; i++) {
    next = moveToNextDate(next, paymentDayNumber, moveHolidayToNextDay);
  }
  return next;
}
