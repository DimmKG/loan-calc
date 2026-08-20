import { describe, expect, it, vi } from "vitest";
import {
  advanceSyncedEarlyRepaymentDate,
  alignToPaymentDate,
  buildRegularPaymentEntry,
  calculateAccruedInterest,
  calculateAmortizationMonthsReduction,
  calculateAnnuityMonthlyPayment,
  calculateMonthFromIssueDate,
  calculateMonthNumber,
  calculateMonthsReduction,
  getMonthDaysAndYearDays,
  moveToNextDate,
  recalculateAmortizationPrincipal,
  recalculateAnnuityPaymentAfterPrepayment,
  roundDecimals,
  splitEarlyRepaymentAmount,
} from "./loan-schedule-helpers";

describe("roundDecimals", () => {
  it("rounds to 2 decimals", () => {
    expect(roundDecimals(1.005001, 2)).toBeCloseTo(1.01, 5);
    expect(roundDecimals(1.004, 2)).toBe(1);
  });

  it("rounds to 0 decimals", () => {
    expect(roundDecimals(1.5, 0)).toBe(2);
    expect(roundDecimals(1.4, 0)).toBe(1);
  });
});

describe("calculateAnnuityMonthlyPayment", () => {
  it("matches the standard annuity formula", () => {
    // P=1,000,000, i=1%/month (12%/year), n=12
    const payment = calculateAnnuityMonthlyPayment({
      principal: 1_000_000,
      monthlyInterestRate: 0.01,
      termMonths: 12,
      roundingDecimals: 2,
    });
    // A = P*i*(1+i)^n / ((1+i)^n - 1)
    const i = 0.01;
    const n = 12;
    const expected = (1_000_000 * i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1);
    expect(payment).toBeCloseTo(expected, 2);
    expect(payment).toBeCloseTo(88848.79, 2);
  });
});

describe("getMonthDaysAndYearDays", () => {
  it("ACTUAL_365 clamps 29-day February to 28", () => {
    const result = getMonthDaysAndYearDays(new Date(2024, 1, 15), "ACTUAL_365");
    expect(result.daysInYear).toBe(365);
    expect(result.daysInMonth).toBe(28);
  });

  it("ACTUAL_ACTUAL uses real 29-day February in a leap year", () => {
    const result = getMonthDaysAndYearDays(new Date(2024, 1, 15), "ACTUAL_ACTUAL");
    expect(result.daysInYear).toBe(366);
    expect(result.daysInMonth).toBe(29);
  });

  it("ACTUAL_ACTUAL uses 365 days in a non-leap year", () => {
    const result = getMonthDaysAndYearDays(new Date(2023, 1, 15), "ACTUAL_ACTUAL");
    expect(result.daysInYear).toBe(365);
  });

  it("defaults to 360/30 for any other basis", () => {
    // @ts-expect-error - exercising the fallback branch
    const result = getMonthDaysAndYearDays(new Date(2024, 1, 15), "UNKNOWN");
    expect(result.daysInYear).toBe(360);
    expect(result.daysInMonth).toBe(30);
  });
});

describe("calculateAccruedInterest", () => {
  it("computes simple daily interest for ACTUAL_365", () => {
    const interest = calculateAccruedInterest({
      principal: 1_000_000,
      annualInterestRatePercent: 12,
      dayCountBasis: "ACTUAL_365",
      fromDate: new Date(2024, 0, 1),
      toDate: new Date(2024, 0, 31),
      roundingDecimals: 2,
    });
    // 1,000,000 * (12/100/365) * 30
    expect(interest).toBeCloseTo(9863.01, 2);
  });

  it("computes simple daily interest for ACTUAL_360", () => {
    const interest = calculateAccruedInterest({
      principal: 1_000_000,
      annualInterestRatePercent: 12,
      dayCountBasis: "ACTUAL_360",
      fromDate: new Date(2024, 0, 1),
      toDate: new Date(2024, 0, 31),
      roundingDecimals: 2,
    });
    // 1,000,000 * (12/100/360) * 30
    expect(interest).toBeCloseTo(10000, 2);
  });

  it("uses 366-day divisor for ACTUAL_ACTUAL spanning leap-year February", () => {
    const interest = calculateAccruedInterest({
      principal: 1_000_000,
      annualInterestRatePercent: 12,
      dayCountBasis: "ACTUAL_ACTUAL",
      fromDate: new Date(2024, 1, 1),
      toDate: new Date(2024, 1, 29),
      roundingDecimals: 2,
    });
    // 1,000,000 * (12/100/366) * 28
    expect(interest).toBeCloseTo(9180.33, 2);
  });
});

describe("calculateMonthsReduction (annuity term-reduction math)", () => {
  it("returns 0 when nothing was paid or nothing remains", () => {
    expect(calculateMonthsReduction(0, 100_000, 0.01, 5000)).toBe(0);
    expect(calculateMonthsReduction(1000, 0, 0.01, 5000)).toBe(0);
  });

  it("returns 0 when the ratio before is out of range", () => {
    expect(calculateMonthsReduction(1000, 100_000, 0.01, 900)).toBe(0);
  });

  it("returns a positive month reduction for a normal partial prepayment", () => {
    // 24-month, 1M principal, 12%/year annuity, prepay 100,000 at month 6
    const payment = calculateAnnuityMonthlyPayment({
      principal: 1_000_000,
      monthlyInterestRate: 0.01,
      termMonths: 24,
      roundingDecimals: 2,
    });
    const reduction = calculateMonthsReduction(100_000, 700_000, 0.01, payment);
    expect(reduction).toBeGreaterThan(0);
    expect(Number.isInteger(reduction)).toBe(true);
  });

  it("returns ceil(monthsBefore) when the prepayment fully pays off the loan", () => {
    const payment = calculateAnnuityMonthlyPayment({
      principal: 1_000_000,
      monthlyInterestRate: 0.01,
      termMonths: 24,
      roundingDecimals: 2,
    });
    const reduction = calculateMonthsReduction(700_000, 700_000, 0.01, payment);
    expect(reduction).toBeGreaterThan(0);
  });

  it("does not write to the console", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const payment = calculateAnnuityMonthlyPayment({
      principal: 1_000_000,
      monthlyInterestRate: 0.01,
      termMonths: 24,
      roundingDecimals: 2,
    });
    calculateMonthsReduction(100_000, 700_000, 0.01, payment);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("calculateAmortizationMonthsReduction", () => {
  it("returns 0 for non-positive inputs", () => {
    expect(
      calculateAmortizationMonthsReduction({
        principalAmountPaid: 0,
        remainingPrincipal: 100_000,
        amortizationPrincipal: 5000,
      })
    ).toBe(0);
  });

  it("reduces the period count proportionally", () => {
    // remaining 100,000 at 5,000/period => 20 periods before.
    // pay off 40,000 => 60,000 remaining => 12 periods after => reduction 8
    const reduction = calculateAmortizationMonthsReduction({
      principalAmountPaid: 40_000,
      remainingPrincipal: 100_000,
      amortizationPrincipal: 5000,
    });
    expect(reduction).toBe(8);
  });

  it("returns the full period count when the prepayment pays off the loan", () => {
    const reduction = calculateAmortizationMonthsReduction({
      principalAmountPaid: 100_000,
      remainingPrincipal: 100_000,
      amortizationPrincipal: 5000,
    });
    expect(reduction).toBe(20);
  });
});

describe("moveToNextDate", () => {
  it("advances one month keeping the payment day", () => {
    const next = moveToNextDate(new Date(2024, 0, 15), 15, false);
    expect(next.getFullYear()).toBe(2024);
    expect(next.getMonth()).toBe(1);
    expect(next.getDate()).toBe(15);
  });

  it("moves a weekend payment date to the following Monday when enabled", () => {
    // 2024-03-16 is a Saturday
    const next = moveToNextDate(new Date(2024, 1, 16), 16, true);
    expect(next.getDay()).not.toBe(0);
    expect(next.getDay()).not.toBe(6);
  });

  it("leaves a weekend payment date as-is when disabled", () => {
    const next = moveToNextDate(new Date(2024, 1, 16), 16, false);
    expect(next.getFullYear()).toBe(2024);
    expect(next.getMonth()).toBe(2);
    expect(next.getDate()).toBe(16);
  });
});

describe("alignToPaymentDate", () => {
  it("forces the day-of-month to paymentDayNumber, no weekend shift needed", () => {
    // 2024-02-16 is a Friday
    const aligned = alignToPaymentDate(new Date(2024, 1, 1), 16, true);
    expect(aligned.getFullYear()).toBe(2024);
    expect(aligned.getMonth()).toBe(1);
    expect(aligned.getDate()).toBe(16);
  });

  it("shifts to the following Monday when the aligned date lands on a weekend", () => {
    // 2024-03-16 is a Saturday
    const aligned = alignToPaymentDate(new Date(2024, 2, 1), 16, true);
    expect(aligned.getDay()).not.toBe(0);
    expect(aligned.getDay()).not.toBe(6);
    expect(aligned.getMonth()).toBe(2);
    expect(aligned.getDate()).toBe(18);
  });

  it("leaves the weekend date as-is when moveHolidayToNextDay is disabled", () => {
    const aligned = alignToPaymentDate(new Date(2024, 2, 1), 16, false);
    expect(aligned.getMonth()).toBe(2);
    expect(aligned.getDate()).toBe(16);
  });
});

describe("advanceSyncedEarlyRepaymentDate", () => {
  it("matches exactly what moveToNextDate would produce N periods later", () => {
    const start = alignToPaymentDate(new Date(2024, 1, 16), 16, true); // 2024-02-16
    const viaAdvance = advanceSyncedEarlyRepaymentDate(start, 1, 16, true);
    const viaMoveToNextDate = moveToNextDate(start, 16, true);
    expect(viaAdvance.getTime()).toBe(viaMoveToNextDate.getTime());

    // 2024-03-16 is a Saturday -> shifted to 2024-03-18
    expect(viaAdvance.getMonth()).toBe(2);
    expect(viaAdvance.getDate()).toBe(18);
  });

  it("chains N times for QUARTERLY/YEARLY-style strides without drifting off paymentDayNumber", () => {
    const start = alignToPaymentDate(new Date(2024, 0, 16), 16, true);
    const quarterly = advanceSyncedEarlyRepaymentDate(start, 3, 16, true);
    let expected = start;
    for (let i = 0; i < 3; i++) {
      expected = moveToNextDate(expected, 16, true);
    }
    expect(quarterly.getTime()).toBe(expected.getTime());
  });
});

describe("calculateMonthFromIssueDate / calculateMonthNumber", () => {
  const issueDate = new Date(2024, 0, 15);

  it("computes month-from-issue for a regular payment on the exact payment day", () => {
    const paymentDate = new Date(2024, 5, 15);
    expect(calculateMonthFromIssueDate(paymentDate, issueDate)).toBe(6);
    expect(calculateMonthNumber(paymentDate, false, 3, issueDate, 15)).toBe(6);
  });

  it("keeps the running counter for a regular payment off the exact payment day", () => {
    const paymentDate = new Date(2024, 5, 20);
    expect(calculateMonthNumber(paymentDate, false, 3, issueDate, 15)).toBe(3);
  });

  it("reuses the regular payment's month number for a same-day early repayment", () => {
    const regularDate = new Date(2024, 5, 15);
    expect(
      calculateMonthNumber(regularDate, true, 3, issueDate, 15, regularDate)
    ).toBe(6);
  });

  it("computes month-from-issue for an early repayment strictly before the regular date", () => {
    const earlyDate = new Date(2024, 5, 20);
    const regularDate = new Date(2024, 6, 15);
    expect(
      calculateMonthNumber(earlyDate, true, 3, issueDate, 15, regularDate)
    ).toBe(6);
  });
});

describe("splitEarlyRepaymentAmount", () => {
  it("absorbs the whole payment into interest when it does not cover accrued interest", () => {
    const result = splitEarlyRepaymentAmount({
      earlyRepaymentAmount: 500,
      accruedInterest: 800,
      remainingPrincipal: 100_000,
      roundingDecimals: 2,
    });
    expect(result.principalPaid).toBe(0);
    expect(result.interestPaid).toBe(500);
    expect(result.remainingInterestCarryover).toBeCloseTo(300, 2);
    expect(result.remainingPrincipalAfter).toBe(100_000);
    expect(result.actualPaymentAmount).toBe(500);
  });

  it("splits normally when the payment exceeds accrued interest", () => {
    const result = splitEarlyRepaymentAmount({
      earlyRepaymentAmount: 10_000,
      accruedInterest: 800,
      remainingPrincipal: 100_000,
      roundingDecimals: 2,
    });
    expect(result.principalPaid).toBeCloseTo(9200, 2);
    expect(result.interestPaid).toBe(800);
    expect(result.remainingPrincipalAfter).toBeCloseTo(90_800, 2);
    expect(result.remainingInterestCarryover).toBe(0);
    expect(result.actualPaymentAmount).toBe(10_000);
  });

  it("clamps overpayment beyond the remaining principal", () => {
    const result = splitEarlyRepaymentAmount({
      earlyRepaymentAmount: 150_000,
      accruedInterest: 800,
      remainingPrincipal: 100_000,
      roundingDecimals: 2,
    });
    expect(result.remainingPrincipalAfter).toBe(0);
    expect(result.principalPaid).toBeCloseTo(100_000, 2);
    expect(result.actualPaymentAmount).toBeCloseTo(100_800, 2);
  });
});

describe("buildRegularPaymentEntry", () => {
  it("computes the ANNUITY split", () => {
    const result = buildRegularPaymentEntry({
      loanType: "ANNUITY",
      interestAmount: 1000,
      remainingPrincipal: 100_000,
      annuityMonthlyPayment: 5000,
      amortizationPrincipal: 0,
      roundingDecimals: 2,
    });
    expect(result.paymentAmount).toBe(5000);
    expect(result.principalAmount).toBe(4000);
    expect(result.remainingPrincipalAfter).toBe(96_000);
  });

  it("computes the AMORTIZATION split", () => {
    const result = buildRegularPaymentEntry({
      loanType: "AMORTIZATION",
      interestAmount: 1000,
      remainingPrincipal: 100_000,
      annuityMonthlyPayment: 0,
      amortizationPrincipal: 4000,
      roundingDecimals: 2,
    });
    expect(result.principalAmount).toBe(4000);
    expect(result.paymentAmount).toBe(5000);
    expect(result.remainingPrincipalAfter).toBe(96_000);
  });
});

describe("recalculateAnnuityPaymentAfterPrepayment / recalculateAmortizationPrincipal", () => {
  it("depends only on the explicitly passed periodsRemaining", () => {
    const payment = recalculateAnnuityPaymentAfterPrepayment({
      remainingPrincipal: 500_000,
      monthlyInterestRate: 0.01,
      periodsRemaining: 18,
      roundingDecimals: 2,
    });
    expect(payment).toBe(
      calculateAnnuityMonthlyPayment({
        principal: 500_000,
        monthlyInterestRate: 0.01,
        termMonths: 18,
        roundingDecimals: 2,
      })
    );
  });

  it("recalculates amortization principal by direct division", () => {
    const principal = recalculateAmortizationPrincipal({
      remainingPrincipal: 90_000,
      periodsRemaining: 18,
      roundingDecimals: 2,
    });
    expect(principal).toBe(5000);
  });

  it("does not divide by zero when no periods remain", () => {
    const principal = recalculateAmortizationPrincipal({
      remainingPrincipal: 90_000,
      periodsRemaining: 0,
      roundingDecimals: 2,
    });
    expect(principal).toBe(90_000);
  });
});
