import { describe, expect, it } from "vitest";
import { generateLoanSchedule } from "./loan-lib";
import { calculateAnnuityPaymentForSchedule } from "./loan-schedule-helpers";
import {
  calculateFullCostOfCredit,
  calculateLoanSummary,
  calculateXirrPercent,
  groupScheduleByMonth,
} from "./loan-statistics";

describe("calculateXirrPercent", () => {
  it("solves the analytic 2-cash-flow case exactly: -P now, +F in exactly 365 days", () => {
    // -P + F/(1+r)^(365/365) = 0  =>  r = F/P - 1
    const rate = calculateXirrPercent([
      { date: new Date(2024, 0, 1), amount: -100_000 },
      { date: new Date(2025, 0, 1), amount: 112_000 },
    ]);
    // 2024 - високосный год, поэтому 1 янв 2024 -> 1 янв 2025 это 366 дней, а не 365;
    // вычисляем ожидаемое значение тем же способом, а не зашиваем 12 напрямую.
    const days = (new Date(2025, 0, 1).getTime() - new Date(2024, 0, 1).getTime()) / 86_400_000;
    const expected = (Math.pow(112_000 / 100_000, 365 / days) - 1) * 100;
    expect(rate).not.toBeNull();
    expect(rate!).toBeCloseTo(expected, 2);
  });

  it("returns null when all cash flows have the same sign", () => {
    expect(
      calculateXirrPercent([
        { date: new Date(2024, 0, 1), amount: 1000 },
        { date: new Date(2024, 1, 1), amount: 2000 },
      ])
    ).toBeNull();
  });

  it("returns null for fewer than 2 cash flows", () => {
    expect(calculateXirrPercent([{ date: new Date(), amount: -100 }])).toBeNull();
  });

  it("matches a hand-verified multi-period case (evenly spaced, no leap-year noise)", () => {
    // 4 равных квартала по 91 дню каждый (364 дня всего), основной долг 100,
    // по одному платежу за квартал, подобранные так, чтобы корень уравнения находился.
    const cashFlows = [
      { date: new Date(2023, 0, 1), amount: -100_000 },
      { date: new Date(2023, 3, 2), amount: 30_000 }, // +91 день
      { date: new Date(2023, 6, 1), amount: 30_000 }, // +182 дня
      { date: new Date(2023, 8, 30), amount: 30_000 }, // +273 дня
      { date: new Date(2023, 11, 29), amount: 40_000 }, // +364 дня
    ];
    const rate = calculateXirrPercent(cashFlows);
    expect(rate).not.toBeNull();

    // Проверяем, подставляя найденную ставку обратно в уравнение NPV напрямую
    // (независимая проверка, а не просто повторный вызов тестируемой функции).
    const r = rate! / 100;
    const base = cashFlows[0].date.getTime();
    const npv = cashFlows.reduce((sum, cf) => {
      const days = (cf.date.getTime() - base) / 86_400_000;
      return sum + cf.amount / Math.pow(1 + r, days / 365);
    }, 0);
    expect(Math.abs(npv)).toBeLessThan(1);
  });
});

describe("calculateFullCostOfCredit", () => {
  it("is close to the effective annual rate for a plain annuity loan with no fees", () => {
    const issueDate = new Date(2024, 0, 15);
    const principal = 1_000_000;
    const annualRate = 12;
    const { schedule } = generateLoanSchedule({
      principal,
      annualInterestRatePercent: annualRate,
      loanType: "ANNUITY",
      termMonths: 12,
      issueDate: new Date(issueDate),
    });

    const psk = calculateFullCostOfCredit({ schedule, principal, issueDate });
    expect(psk).not.toBeNull();

    // Без комиссий, ежемесячная капитализация при номинальных 12%/год =>
    // эффективная годовая ставка = (1+0.01)^12 - 1 ≈ 12.68%. Реальная длина
    // календарных месяцев меняется, поэтому допускаем небольшую погрешность
    // вместо точного равенства.
    const effectiveAnnual = (Math.pow(1.01, 12) - 1) * 100;
    expect(psk!).toBeGreaterThan(annualRate);
    expect(psk!).toBeCloseTo(effectiveAnnual, 0);
  });

  it("returns null for an empty schedule", () => {
    expect(
      calculateFullCostOfCredit({ schedule: [], principal: 100_000, issueDate: new Date() })
    ).toBeNull();
  });

  it("rises when the same schedule is paid off with a smaller principal (implicit fee-like gap)", () => {
    // Те же платежи, но фактически выдано меньше денег -> эффективная ставка должна быть выше.
    const issueDate = new Date(2024, 0, 15);
    const { schedule } = generateLoanSchedule({
      principal: 1_000_000,
      annualInterestRatePercent: 12,
      loanType: "ANNUITY",
      termMonths: 12,
      issueDate: new Date(issueDate),
    });

    const pskFull = calculateFullCostOfCredit({
      schedule,
      principal: 1_000_000,
      issueDate,
    })!;
    const pskReduced = calculateFullCostOfCredit({
      schedule,
      principal: 950_000,
      issueDate,
    })!;
    expect(pskReduced).toBeGreaterThan(pskFull);
  });
});

describe("calculateLoanSummary", () => {
  it("aggregates totals and reconciles totalPayments = totalPrincipal + totalInterest", () => {
    const issueDate = new Date(2024, 0, 15);
    const principal = 1_200_000;
    const result = generateLoanSchedule({
      principal,
      annualInterestRatePercent: 12,
      loanType: "ANNUITY",
      termMonths: 24,
      issueDate: new Date(issueDate),
    });

    const summary = calculateLoanSummary({ result, principal, issueDate })!;
    expect(summary).toBeDefined();
    expect(summary.totalPrincipal).toBeCloseTo(principal, 2);
    expect(summary.totalPayments).toBeCloseTo(
      summary.totalPrincipal + summary.totalInterest,
      2
    );
    expect(summary.overpaymentAmount).toBeCloseTo(summary.totalInterest, 2);
    expect(summary.overpaymentPercent).toBeCloseTo(
      (summary.totalInterest / principal) * 100,
      2
    );
    expect(summary.termMonths).toBe(24);
    // Платёж пересчитывается методом goal-seek (по умолчанию
    // fullInterestModeling: true) по реальным датам периодов, а не по
    // плоской формульной ставке.
    expect(summary.monthlyPayment).toBe(
      calculateAnnuityPaymentForSchedule({
        principal,
        annualInterestRatePercent: 12,
        dayCountBasis: "ACTUAL_365",
        startDate: issueDate,
        paymentDayNumber: 15,
        moveHolidayToNextDay: false,
        termMonths: 24,
        roundingDecimals: 2,
      })
    );
    expect(summary.fullCostOfCreditPercent).toBeGreaterThan(12);
  });

  it("reports a shorter termMonths when DECREASE_TERM early repayment shortens the loan", () => {
    const issueDate = new Date(2024, 0, 15);
    const principal = 1_200_000;
    const baseline = generateLoanSchedule({
      principal,
      annualInterestRatePercent: 12,
      loanType: "ANNUITY",
      termMonths: 24,
      issueDate: new Date(issueDate),
    });
    const withEarlyRepayment = generateLoanSchedule({
      principal,
      annualInterestRatePercent: 12,
      loanType: "ANNUITY",
      termMonths: 24,
      issueDate: new Date(issueDate),
      earlyRepayments: [
        {
          earlyRepaymentDateStart: new Date(2024, 3, 10),
          earlyRepaymentAmount: 300_000,
          periodicity: "ONCE",
          repaymentType: "DECREASE_TERM",
        },
      ],
    });

    const baselineSummary = calculateLoanSummary({
      result: baseline,
      principal,
      issueDate: new Date(issueDate),
    })!;
    const shortenedSummary = calculateLoanSummary({
      result: withEarlyRepayment,
      principal,
      issueDate: new Date(issueDate),
    })!;

    expect(shortenedSummary.termMonths).toBeLessThan(baselineSummary.termMonths);
    expect(shortenedSummary.totalInterest).toBeLessThan(baselineSummary.totalInterest);
  });

  it("returns undefined for an empty schedule", () => {
    expect(
      calculateLoanSummary({
        result: { schedule: [], startMonthlyPayment: 0 },
        principal: 100_000,
        issueDate: new Date(),
      })
    ).toBeUndefined();
  });
});

describe("groupScheduleByMonth", () => {
  it("sums amounts within a month and keeps the last entry's remaining principal (not a sum)", () => {
    const { schedule } = generateLoanSchedule({
      principal: 500_000,
      annualInterestRatePercent: 12,
      loanType: "ANNUITY",
      termMonths: 12,
      issueDate: new Date(2024, 0, 15),
      earlyRepayments: [
        {
          // Попадание в тот же календарный месяц, что и месяц, следующий за
          // январским обычным платежом, не гарантировано; выбираем дату
          // заведомо внутри периода 1.
          earlyRepaymentDateStart: new Date(2024, 1, 20),
          earlyRepaymentAmount: 20_000,
          periodicity: "ONCE",
          repaymentType: "DECREASE_TERM",
        },
      ],
    });

    const grouped = groupScheduleByMonth(schedule);
    expect(grouped.length).toBeGreaterThan(0);

    // Находим месяц с 2 записями (обычный платёж + досрочное погашение).
    const rawGroups = new Map<string, typeof schedule>();
    for (const entry of schedule) {
      const key = `${entry.paymentDate.getFullYear()}-${entry.paymentDate.getMonth()}`;
      rawGroups.set(key, [...(rawGroups.get(key) ?? []), entry]);
    }
    const [multiKey, multiEntries] = [...rawGroups.entries()].find(
      ([, v]) => v.length > 1
    )!;
    const [year, month] = multiKey.split("-").map(Number);
    const groupedMonth = grouped.find(
      (g) => g.paymentDate.getFullYear() === year && g.paymentDate.getMonth() === month
    )!;

    const expectedRemaining = multiEntries[multiEntries.length - 1].remainingPrincipal;
    const naiveSum = multiEntries.reduce((s, e) => s + e.remainingPrincipal, 0);
    expect(groupedMonth.remainingPrincipal).toBeCloseTo(expectedRemaining, 2);
    // Защита от возврата исходной ошибки (суммирования остатков).
    expect(groupedMonth.remainingPrincipal).not.toBeCloseTo(naiveSum, 2);
  });
});
