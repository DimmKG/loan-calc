import { differenceInCalendarDays, differenceInMonths } from "date-fns";
import type { LoanScheduleEntry, LoanScheduleResult } from "./loan-lib";
import { roundDecimals } from "./loan-schedule-helpers";

export interface CashFlow {
  date: Date;
  amount: number;
}

export interface LoanSummary {
  totalPayments: number;
  totalPrincipal: number;
  totalInterest: number;
  /** Переплата по кредиту = сумма всех процентов. */
  overpaymentAmount: number;
  /** Переплата в процентах от суммы кредита. */
  overpaymentPercent: number;
  monthlyPayment: number;
  /** Фактический срок кредита в месяцах (может отличаться от исходного из-за досрочных погашений). */
  termMonths: number;
  /**
   * Полная стоимость кредита (ПСК), % годовых — эффективная ставка,
   * при дисконтировании по которой сумма всех платежей по факту
   * приведённых дат равна сумме кредита (аналог XIRR). null, если
   * не удалось решить уравнение (например, пустой график).
   */
  fullCostOfCreditPercent: number | null;
}

function npvAtRate(rate: number, flows: { days: number; amount: number }[]): number {
  return flows.reduce(
    (sum, cf) => sum + cf.amount / Math.pow(1 + rate, cf.days / 365),
    0
  );
}

function npvDerivativeAtRate(
  rate: number,
  flows: { days: number; amount: number }[]
): number {
  return flows.reduce((sum, cf) => {
    if (cf.days === 0) return sum;
    const exponent = cf.days / 365;
    return sum - (exponent * cf.amount) / Math.pow(1 + rate, exponent + 1);
  }, 0);
}

/**
 * Находит годовую эффективную ставку (в процентах), при которой чистая
 * приведённая стоимость денежных потоков равна нулю (аналог функции
 * XIRR). Требует хотя бы один отрицательный и один положительный поток.
 * Возвращает null, если решение не найдено (некорректные входные данные
 * или уравнение не сходится).
 */
export function calculateXirrPercent(cashFlows: CashFlow[]): number | null {
  if (cashFlows.length < 2) return null;

  const sorted = [...cashFlows].sort((a, b) => a.date.getTime() - b.date.getTime());
  const baseDate = sorted[0].date;
  const flows = sorted.map((cf) => ({
    days: differenceInCalendarDays(cf.date, baseDate),
    amount: cf.amount,
  }));

  const hasPositive = flows.some((f) => f.amount > 0);
  const hasNegative = flows.some((f) => f.amount < 0);
  if (!hasPositive || !hasNegative) return null;

  const scale = Math.max(...flows.map((f) => Math.abs(f.amount)), 1);
  const tolerance = scale * 1e-7;

  // Метод Ньютона
  let rate = 0.1;
  for (let i = 0; i < 100; i++) {
    const value = npvAtRate(rate, flows);
    if (Math.abs(value) < tolerance) {
      return roundDecimals(rate * 100, 3);
    }
    const derivative = npvDerivativeAtRate(rate, flows);
    if (Math.abs(derivative) < 1e-12) break;
    const nextRate = rate - value / derivative;
    if (!Number.isFinite(nextRate) || nextRate <= -1) break;
    rate = nextRate;
  }

  // Резервный метод бисекции — на случай, если Ньютон разошёлся
  let low = -0.99;
  let high = 10;
  let npvLow = npvAtRate(low, flows);
  let npvHigh = npvAtRate(high, flows);
  let expandAttempts = 0;
  while (npvLow * npvHigh > 0 && expandAttempts < 60 && high < 1e6) {
    high *= 2;
    npvHigh = npvAtRate(high, flows);
    expandAttempts++;
  }
  if (npvLow * npvHigh > 0) return null;

  for (let i = 0; i < 200; i++) {
    const mid = (low + high) / 2;
    const npvMid = npvAtRate(mid, flows);
    if (Math.abs(npvMid) < tolerance) {
      return roundDecimals(mid * 100, 3);
    }
    if (Math.sign(npvMid) === Math.sign(npvLow)) {
      low = mid;
      npvLow = npvMid;
    } else {
      high = mid;
    }
  }
  return roundDecimals(((low + high) / 2) * 100, 3);
}

/**
 * Полная стоимость кредита (ПСК), % годовых, по методике Банка России
 * (Указание № 3854-У): эффективная ставка, дисконтирование по которой
 * приравнивает сумму кредита (отток на дату выдачи) к сумме всех
 * платежей по факту дат в графике.
 */
export function calculateFullCostOfCredit(params: {
  schedule: LoanScheduleEntry[];
  principal: number;
  issueDate: Date;
}): number | null {
  const { schedule, principal, issueDate } = params;
  if (schedule.length === 0 || principal <= 0) return null;

  const cashFlows: CashFlow[] = [
    { date: issueDate, amount: -principal },
    ...schedule.map((entry) => ({
      date: entry.paymentDate,
      amount: entry.paymentAmount,
    })),
  ];

  return calculateXirrPercent(cashFlows);
}

/**
 * Сводная статистика по кредиту, вычисляемая по уже готовому графику
 * платежей. Возвращает undefined для пустого графика.
 */
export function calculateLoanSummary(params: {
  result: LoanScheduleResult;
  principal: number;
  issueDate: Date;
  roundingDecimals?: number;
}): LoanSummary | undefined {
  const { result, principal, issueDate, roundingDecimals = 2 } = params;
  const { schedule, startMonthlyPayment } = result;
  if (schedule.length === 0) return undefined;

  const totalPayments = roundDecimals(
    schedule.reduce((sum, item) => sum + item.paymentAmount, 0),
    roundingDecimals
  );
  const totalPrincipal = roundDecimals(
    schedule.reduce((sum, item) => sum + item.principalAmount, 0),
    roundingDecimals
  );
  const totalInterest = roundDecimals(
    schedule.reduce((sum, item) => sum + item.interestAmount, 0),
    roundingDecimals
  );
  const overpaymentAmount = totalInterest;
  const overpaymentPercent = roundDecimals(
    principal > 0 ? (totalInterest / principal) * 100 : 0,
    roundingDecimals
  );

  const termMonths =
    differenceInMonths(
      schedule[schedule.length - 1].paymentDate,
      schedule[0].paymentDate
    ) + 1;

  const fullCostOfCreditPercent = calculateFullCostOfCredit({
    schedule,
    principal,
    issueDate,
  });

  return {
    totalPayments,
    totalPrincipal,
    totalInterest,
    overpaymentAmount,
    overpaymentPercent,
    monthlyPayment: startMonthlyPayment,
    termMonths,
    fullCostOfCreditPercent,
  };
}

/**
 * Группирует график платежей по календарным месяцам (для графика/чарта),
 * суммируя суммы платежей за месяц и беря остаток долга на последний
 * платёж в месяце (а не сумму остатков всех платежей за месяц).
 */
export function groupScheduleByMonth(
  schedule: LoanScheduleEntry[]
): LoanScheduleEntry[] {
  const groups = new Map<string, LoanScheduleEntry[]>();
  for (const entry of schedule) {
    const key = `${entry.paymentDate.getFullYear()}-${String(
      entry.paymentDate.getMonth() + 1
    ).padStart(2, "0")}`;
    const group = groups.get(key);
    if (group) {
      group.push(entry);
    } else {
      groups.set(key, [entry]);
    }
  }

  return Array.from(groups.entries()).map(([key, items]) => {
    const [year, month] = key.split("-").map(Number);
    return {
      monthNumber: items[0].monthNumber,
      paymentDate: new Date(year, month - 1, 1),
      paymentAmount: roundDecimals(
        items.reduce((sum, item) => sum + item.paymentAmount, 0),
        2
      ),
      principalAmount: roundDecimals(
        items.reduce((sum, item) => sum + item.principalAmount, 0),
        2
      ),
      interestAmount: roundDecimals(
        items.reduce((sum, item) => sum + item.interestAmount, 0),
        2
      ),
      remainingPrincipal: items[items.length - 1].remainingPrincipal,
    };
  });
}
