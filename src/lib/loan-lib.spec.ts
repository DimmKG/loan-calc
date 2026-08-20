import { differenceInMonths } from "date-fns";
import { describe, expect, it } from "vitest";
import { generateLoanSchedule } from "./loan-lib";
import {
  calculateAccruedInterest,
  calculateAmortizationMonthsReduction,
  calculateAnnuityMonthlyPayment,
  calculateMonthsReduction,
  recalculateAmortizationPrincipal,
} from "./loan-schedule-helpers";

const round2 = (n: number) => Math.round(n * 100) / 100;
const sum = (values: number[]) => round2(values.reduce((a, b) => a + b, 0));
// Local-date formatter: paymentDate values are constructed/compared using local
// getters throughout the app, so toISOString() (UTC-based) would misreport the
// day whenever the test runner's timezone offset is non-zero.
const localDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;

describe("generateLoanSchedule - baseline invariants (ANNUITY / AMORTIZATION)", () => {
  it("ANNUITY: schedule length matches term, principal reconciles, balance monotonically decreases to 0", () => {
    const { schedule, startMonthlyPayment } = generateLoanSchedule({
      principal: 1_000_000,
      annualInterestRatePercent: 12,
      loanType: "ANNUITY",
      termMonths: 12,
      issueDate: new Date(2024, 0, 15),
    });

    expect(schedule).toHaveLength(12);
    expect(sum(schedule.map((e) => e.principalAmount))).toBeCloseTo(1_000_000, 2);
    expect(schedule.at(-1)!.remainingPrincipal).toBe(0);

    let prev = 1_000_000;
    for (const entry of schedule) {
      expect(entry.remainingPrincipal).toBeLessThanOrEqual(prev);
      prev = entry.remainingPrincipal;
    }
    expect(startMonthlyPayment).toBeGreaterThan(0);
    for (const entry of schedule.slice(0, -1)) {
      expect(entry.paymentAmount).toBeCloseTo(startMonthlyPayment, 2);
    }
  });

  it("AMORTIZATION: constant principal portion, decreasing payment, reconciles to principal", () => {
    const { schedule } = generateLoanSchedule({
      principal: 1_200_000,
      annualInterestRatePercent: 12,
      loanType: "AMORTIZATION",
      termMonths: 12,
      issueDate: new Date(2024, 0, 15),
    });

    expect(schedule).toHaveLength(12);
    expect(sum(schedule.map((e) => e.principalAmount))).toBeCloseTo(1_200_000, 2);
    expect(schedule.at(-1)!.remainingPrincipal).toBe(0);

    for (const entry of schedule.slice(0, -1)) {
      expect(entry.principalAmount).toBeCloseTo(100_000, 2);
    }
    for (let i = 1; i < schedule.length; i++) {
      expect(schedule[i].paymentAmount).toBeLessThan(schedule[i - 1].paymentAmount);
    }
  });
});

describe("generateLoanSchedule - day count basis", () => {
  it("ACTUAL_360: first period interest uses a 360-day divisor", () => {
    const issueDate = new Date(2024, 0, 15);
    const { schedule } = generateLoanSchedule({
      principal: 1_000_000,
      annualInterestRatePercent: 12,
      loanType: "AMORTIZATION",
      termMonths: 12,
      issueDate,
      dayCountBasis: "ACTUAL_360",
    });

    const expectedInterest = calculateAccruedInterest({
      principal: 1_000_000,
      annualInterestRatePercent: 12,
      dayCountBasis: "ACTUAL_360",
      fromDate: issueDate,
      toDate: new Date(2024, 1, 15),
      roundingDecimals: 2,
    });
    expect(schedule[0].interestAmount).toBeCloseTo(expectedInterest, 2);
  });

  it("ACTUAL_ACTUAL: a period spanning a leap-year February uses the 366-day divisor", () => {
    const issueDate = new Date(2024, 0, 29);
    const { schedule } = generateLoanSchedule({
      principal: 1_000_000,
      annualInterestRatePercent: 12,
      loanType: "AMORTIZATION",
      termMonths: 6,
      issueDate,
      dayCountBasis: "ACTUAL_ACTUAL",
    });

    const expectedInterest = calculateAccruedInterest({
      principal: 1_000_000,
      annualInterestRatePercent: 12,
      dayCountBasis: "ACTUAL_ACTUAL",
      fromDate: issueDate,
      toDate: new Date(2024, 1, 29),
      roundingDecimals: 2,
    });
    expect(schedule[0].interestAmount).toBeCloseTo(expectedInterest, 2);
  });
});

describe("generateLoanSchedule - options", () => {
  it("interestOnlyFirstPeriod: first entry is interest-only, term matches termMonths by default (bank-accurate, no +1 month)", () => {
    const issueDate = new Date(2024, 0, 15);
    const { schedule } = generateLoanSchedule({
      principal: 600_000,
      annualInterestRatePercent: 10,
      loanType: "ANNUITY",
      termMonths: 6,
      issueDate: new Date(issueDate),
      interestOnlyFirstPeriod: true,
    });

    expect(schedule[0].principalAmount).toBe(0);
    expect(schedule[0].interestAmount).toBeGreaterThan(0);
    // 1 interest-only + 4 regular = 5 total, spanning 5 months from issue
    // (the grace month counts as one of the 6 stated termMonths, it doesn't
    // add a 6th month on top).
    expect(schedule).toHaveLength(5);
    expect(
      differenceInMonths(schedule[schedule.length - 1].paymentDate, issueDate)
    ).toBe(5);
  });

  it("interestOnlyPeriodExtendsTerm: true restores the legacy +1 month behavior", () => {
    const issueDate = new Date(2024, 0, 15);
    const { schedule } = generateLoanSchedule({
      principal: 600_000,
      annualInterestRatePercent: 10,
      loanType: "ANNUITY",
      termMonths: 6,
      issueDate: new Date(issueDate),
      interestOnlyFirstPeriod: true,
      interestOnlyPeriodExtendsTerm: true,
    });

    expect(schedule[0].principalAmount).toBe(0);
    // 1 interest-only + 5 regular = 6 total, spanning 6 months from issue -
    // one month more than the new (default) behavior above.
    expect(schedule).toHaveLength(6);
    expect(
      differenceInMonths(schedule[schedule.length - 1].paymentDate, issueDate)
    ).toBe(6);
  });

  it("large long-term loan: interest-only + weekend shift together still avoid the extra month", () => {
    // 15-year loan, interest-only first month, payment day chosen so the
    // very first regular payment lands on a Saturday and must shift.
    const issueDate = new Date(2024, 2, 25); // 2024-03-25
    const paymentDayNumber = 20;
    const termMonths = 180;
    const { schedule } = generateLoanSchedule({
      principal: 5_000_000,
      annualInterestRatePercent: 9,
      loanType: "ANNUITY",
      termMonths,
      issueDate: new Date(issueDate),
      paymentDayNumber,
      interestOnlyFirstPeriod: true,
      moveHolidayToNextDay: true,
      dayCountBasis: "ACTUAL_365",
    });

    // First payment: issueDate rolled to day 20 then +1 month = 2024-04-20,
    // a Saturday -> shifted to Monday 2024-04-22.
    expect(schedule[0].paymentDate.getFullYear()).toBe(2024);
    expect(schedule[0].paymentDate.getMonth()).toBe(3); // April
    expect(schedule[0].paymentDate.getDate()).toBe(22);
    expect(schedule[0].principalAmount).toBe(0);
    const expectedFirstInterest = calculateAccruedInterest({
      principal: 5_000_000,
      annualInterestRatePercent: 9,
      dayCountBasis: "ACTUAL_365",
      fromDate: issueDate,
      toDate: schedule[0].paymentDate,
      roundingDecimals: 2,
    });
    expect(schedule[0].interestAmount).toBeCloseTo(expectedFirstInterest, 2);

    // No +1 month: total span should be within 1 month of termMonths-1 (the
    // annuity payment here uses a flat annualRate/12 monthly rate rather
    // than exact day-count amortization, so the "remainingPrincipal <=
    // annuityMonthlyPayment" early-payoff shortcut can legitimately land the
    // final lump-sum payment a month earlier than the theoretical value) -
    // and must stay well short of the old (pre-fix) termMonths span.
    const lastPayment = schedule[schedule.length - 1];
    const monthsElapsed = differenceInMonths(lastPayment.paymentDate, issueDate);
    expect(monthsElapsed).toBeGreaterThanOrEqual(termMonths - 2);
    expect(monthsElapsed).toBeLessThanOrEqual(termMonths - 1);
    expect(lastPayment.remainingPrincipal).toBe(0);
  });

  it("regression: long-term ANNUITY loan does not dump a balloon payment at the end", () => {
    // The annuity payment is sized off the nominal monthly rate
    // (annualRate/12), while interest actually accrues off real calendar
    // days (ACT/365). Over a 30-year term these two models drift apart by
    // a fraction of a percent, which used to be dumped entirely into a
    // single oversized payment forced at exactly termMonths. The schedule
    // should instead be allowed to run a payment longer/shorter so the
    // drift settles naturally into a small, in-range final payment.
    const issueDate = new Date(2020, 0, 15);
    const paymentDayNumber = 15;
    const termMonths = 360;
    const { schedule, startMonthlyPayment } = generateLoanSchedule({
      principal: 6_000_000,
      annualInterestRatePercent: 7,
      loanType: "ANNUITY",
      termMonths,
      issueDate: new Date(issueDate),
      paymentDayNumber,
      dayCountBasis: "ACTUAL_365",
    });

    const lastPayment = schedule[schedule.length - 1];
    expect(lastPayment.remainingPrincipal).toBe(0);
    expect(schedule.length).toBeGreaterThanOrEqual(termMonths - 1);
    expect(schedule.length).toBeLessThanOrEqual(termMonths + 2);
    expect(lastPayment.paymentAmount).toBeLessThan(startMonthlyPayment * 1.1);
  });

  it("moveHolidayToNextDay: a weekend payment date shifts to the following Monday", () => {
    // paymentDayNumber 16, 2024-03-16 is a Saturday
    const { schedule } = generateLoanSchedule({
      principal: 300_000,
      annualInterestRatePercent: 10,
      loanType: "ANNUITY",
      termMonths: 6,
      issueDate: new Date(2024, 0, 16),
      moveHolidayToNextDay: true,
    });

    const marchEntry = schedule.find(
      (e) => e.paymentDate.getMonth() === 2 && !e.isEarlyRepayment
    )!;
    expect(marchEntry.paymentDate.getDay()).not.toBe(0);
    expect(marchEntry.paymentDate.getDay()).not.toBe(6);
  });

  it("without moveHolidayToNextDay, the weekend payment date is left as-is", () => {
    const { schedule } = generateLoanSchedule({
      principal: 300_000,
      annualInterestRatePercent: 10,
      loanType: "ANNUITY",
      termMonths: 6,
      issueDate: new Date(2024, 0, 16),
      moveHolidayToNextDay: false,
    });

    const marchEntry = schedule.find(
      (e) => e.paymentDate.getMonth() === 2 && !e.isEarlyRepayment
    )!;
    expect(marchEntry.paymentDate.getDate()).toBe(16);
  });
});

describe("generateLoanSchedule - early repayment basics", () => {
  it("a full early payoff terminates the schedule immediately", () => {
    const { schedule } = generateLoanSchedule({
      principal: 500_000,
      annualInterestRatePercent: 12,
      loanType: "ANNUITY",
      termMonths: 24,
      issueDate: new Date(2024, 0, 15),
      earlyRepayments: [
        {
          earlyRepaymentDateStart: new Date(2024, 2, 10),
          earlyRepaymentAmount: 10_000_000,
          periodicity: "ONCE",
          repaymentType: "DECREASE_TERM",
        },
      ],
    });

    const last = schedule.at(-1)!;
    expect(last.isEarlyRepayment).toBe(true);
    expect(last.remainingPrincipal).toBe(0);
  });

  it("an early repayment overshooting the remaining principal is clamped to the actual amount used", () => {
    const { schedule } = generateLoanSchedule({
      principal: 500_000,
      annualInterestRatePercent: 12,
      loanType: "ANNUITY",
      termMonths: 24,
      issueDate: new Date(2024, 0, 15),
      earlyRepayments: [
        {
          earlyRepaymentDateStart: new Date(2024, 2, 10),
          earlyRepaymentAmount: 10_000_000,
          periodicity: "ONCE",
        },
      ],
    });

    const entry = schedule.find((e) => e.isEarlyRepayment)!;
    expect(entry.paymentAmount).toBeLessThan(10_000_000);
    expect(entry.remainingPrincipal).toBe(0);
  });

  it("an early repayment smaller than accrued interest is absorbed into interest, principal untouched", () => {
    const issueDate = new Date(2024, 0, 15);
    const earlyDate = new Date(2024, 1, 10);
    const accrued = calculateAccruedInterest({
      principal: 500_000,
      annualInterestRatePercent: 12,
      dayCountBasis: "ACTUAL_365",
      fromDate: issueDate,
      toDate: earlyDate,
      roundingDecimals: 2,
    });

    const { schedule } = generateLoanSchedule({
      principal: 500_000,
      annualInterestRatePercent: 12,
      loanType: "ANNUITY",
      termMonths: 24,
      issueDate,
      earlyRepayments: [
        {
          earlyRepaymentDateStart: earlyDate,
          earlyRepaymentAmount: round2(accrued / 2),
          periodicity: "ONCE",
        },
      ],
    });

    const earlyEntry = schedule.find((e) => e.isEarlyRepayment)!;
    expect(earlyEntry.principalAmount).toBe(0);
    expect(earlyEntry.remainingPrincipal).toBe(500_000);

    // the shortfall must be carried into the next regular payment's interest
    const nextRegular = schedule.find((e) => !e.isEarlyRepayment)!;
    const expectedCarriedInterest = round2(accrued - round2(accrued / 2));
    expect(nextRegular.interestAmount).toBeGreaterThanOrEqual(expectedCarriedInterest);
  });
});

describe("generateLoanSchedule - DECREASE_TERM strictly before the next regular date (already-correct baseline)", () => {
  it("ANNUITY: payment stays the same, term shrinks by the hand-computed reduction", () => {
    const issueDate = new Date(2024, 0, 15);
    const baseline = generateLoanSchedule({
      principal: 1_200_000,
      annualInterestRatePercent: 12,
      loanType: "ANNUITY",
      termMonths: 24,
      issueDate: new Date(issueDate),
    });
    const startPayment = baseline.startMonthlyPayment;
    const remainingBeforeRepayment = baseline.schedule[1].remainingPrincipal; // after 2 regular payments

    // After 2 regular payments (Feb15, Mar15), the loop's currentDate/nextDate
    // window for period 3 is [Mar15, Apr15) - the early repayment must land
    // strictly inside that window to be applied "before" period 3's own payment.
    const earlyDate = new Date(2024, 3, 10); // before period-3's 2024-04-15 payment
    const accrued = calculateAccruedInterest({
      principal: remainingBeforeRepayment,
      annualInterestRatePercent: 12,
      dayCountBasis: "ACTUAL_365",
      fromDate: new Date(2024, 2, 15),
      toDate: earlyDate,
      roundingDecimals: 2,
    });
    const repaymentAmount = 100_000;
    const principalPaid = round2(repaymentAmount - accrued);
    const expectedReduction = calculateMonthsReduction(
      principalPaid,
      remainingBeforeRepayment,
      0.01,
      startPayment
    );

    const { schedule } = generateLoanSchedule({
      principal: 1_200_000,
      annualInterestRatePercent: 12,
      loanType: "ANNUITY",
      termMonths: 24,
      issueDate: new Date(issueDate),
      earlyRepayments: [
        {
          earlyRepaymentDateStart: earlyDate,
          earlyRepaymentAmount: repaymentAmount,
          periodicity: "ONCE",
          repaymentType: "DECREASE_TERM",
        },
      ],
    });

    const regularEntries = schedule.filter((e) => !e.isEarlyRepayment);
    // calculateMonthsReduction is a continuous-formula approximation (floored),
    // so the discrete, rounded-to-the-cent schedule can land within 1 period of it.
    expect(regularEntries.length).toBeGreaterThanOrEqual(24 - expectedReduction - 1);
    expect(regularEntries.length).toBeLessThanOrEqual(24 - expectedReduction + 1);
    expect(regularEntries.length).toBeLessThan(24);
    for (const entry of regularEntries.slice(0, -1)) {
      expect(entry.paymentAmount).toBeCloseTo(startPayment, 2);
    }
  });
});

describe("generateLoanSchedule - regression: early repayment landing exactly on a regular payment date", () => {
  function baselineRemainingAfterPeriods(periods: number) {
    const { schedule } = generateLoanSchedule({
      principal: 1_200_000,
      annualInterestRatePercent: 12,
      loanType: "ANNUITY",
      termMonths: 24,
      issueDate: new Date(2024, 0, 15),
    });
    return schedule[periods - 1].remainingPrincipal;
  }

  it("DECREASE_PAYMENT: recomputed payment uses the correct remaining term (excludes the just-paid period) and accrues zero extra interest", () => {
    const remainingAfter6 = baselineRemainingAfterPeriods(6);
    const repaymentAmount = 100_000;

    const { schedule } = generateLoanSchedule({
      principal: 1_200_000,
      annualInterestRatePercent: 12,
      loanType: "ANNUITY",
      termMonths: 24,
      issueDate: new Date(2024, 0, 15),
      earlyRepayments: [
        {
          earlyRepaymentDateStart: new Date(2024, 6, 15), // exactly period 6's payment date
          earlyRepaymentAmount: repaymentAmount,
          periodicity: "ONCE",
          repaymentType: "DECREASE_PAYMENT",
        },
      ],
    });

    const earlyEntry = schedule.find((e) => e.isEarlyRepayment)!;
    // No extra interest should accrue for a repayment made the same day as the regular payment.
    expect(earlyEntry.interestAmount).toBe(0);
    expect(earlyEntry.principalAmount).toBeCloseTo(repaymentAmount, 2);

    const remainingAfterEarlyRepayment = round2(remainingAfter6 - repaymentAmount);
    expect(earlyEntry.remainingPrincipal).toBeCloseTo(remainingAfterEarlyRepayment, 2);

    // Correct term remaining after period 6 = 24 - 6 = 18 (not 19, the pre-fix off-by-one).
    const expectedNewPayment = calculateAnnuityMonthlyPayment({
      principal: remainingAfterEarlyRepayment,
      monthlyInterestRate: 0.01,
      termMonths: 18,
      roundingDecimals: 2,
    });

    const entriesAfterEarlyRepayment = schedule
      .slice(schedule.indexOf(earlyEntry) + 1)
      .filter((e) => !e.isEarlyRepayment);
    for (const entry of entriesAfterEarlyRepayment.slice(0, -1)) {
      expect(entry.paymentAmount).toBeCloseTo(expectedNewPayment, 2);
    }
  });

  it("DECREASE_TERM: term reduction is computed from the correct remaining term, not one month too long", () => {
    const remainingAfter6 = baselineRemainingAfterPeriods(6);
    const repaymentAmount = 100_000;
    const startPayment = calculateAnnuityMonthlyPayment({
      principal: 1_200_000,
      monthlyInterestRate: 0.01,
      termMonths: 24,
      roundingDecimals: 2,
    });

    const { schedule } = generateLoanSchedule({
      principal: 1_200_000,
      annualInterestRatePercent: 12,
      loanType: "ANNUITY",
      termMonths: 24,
      issueDate: new Date(2024, 0, 15),
      earlyRepayments: [
        {
          earlyRepaymentDateStart: new Date(2024, 6, 15),
          earlyRepaymentAmount: repaymentAmount,
          periodicity: "ONCE",
          repaymentType: "DECREASE_TERM",
        },
      ],
    });

    const remainingAfterEarlyRepayment = round2(remainingAfter6 - repaymentAmount);
    const expectedReduction = calculateMonthsReduction(
      repaymentAmount,
      remainingAfter6,
      0.01,
      startPayment
    );

    const regularEntries = schedule.filter((e) => !e.isEarlyRepayment);
    // 6 already paid + remaining reduced term. calculateMonthsReduction is a
    // continuous-formula approximation (floored), so the discrete, rounded
    // schedule can land within 1 period of it.
    const expectedLength = 6 + (24 - 6 - expectedReduction);
    expect(regularEntries.length).toBeGreaterThanOrEqual(expectedLength - 1);
    expect(regularEntries.length).toBeLessThanOrEqual(expectedLength + 1);
    expect(regularEntries.length).toBeLessThan(24);
    void remainingAfterEarlyRepayment;
  });

  it("AMORTIZATION: recomputed per-period principal uses the correct remaining term", () => {
    const { schedule: baselineSchedule } = generateLoanSchedule({
      principal: 1_200_000,
      annualInterestRatePercent: 12,
      loanType: "AMORTIZATION",
      termMonths: 24,
      issueDate: new Date(2024, 0, 15),
    });
    const remainingAfter6 = baselineSchedule[5].remainingPrincipal;
    const repaymentAmount = 100_000;

    const { schedule } = generateLoanSchedule({
      principal: 1_200_000,
      annualInterestRatePercent: 12,
      loanType: "AMORTIZATION",
      termMonths: 24,
      issueDate: new Date(2024, 0, 15),
      earlyRepayments: [
        {
          earlyRepaymentDateStart: new Date(2024, 6, 15),
          earlyRepaymentAmount: repaymentAmount,
          periodicity: "ONCE",
          repaymentType: "DECREASE_PAYMENT",
        },
      ],
    });

    const earlyEntry = schedule.find((e) => e.isEarlyRepayment)!;
    expect(earlyEntry.interestAmount).toBe(0);
    const remainingAfterEarlyRepayment = round2(remainingAfter6 - repaymentAmount);

    const expectedNewPrincipal = recalculateAmortizationPrincipal({
      remainingPrincipal: remainingAfterEarlyRepayment,
      periodsRemaining: 18,
      roundingDecimals: 2,
    });

    const entriesAfterEarlyRepayment = schedule
      .slice(schedule.indexOf(earlyEntry) + 1)
      .filter((e) => !e.isEarlyRepayment);
    for (const entry of entriesAfterEarlyRepayment.slice(0, -1)) {
      expect(entry.principalAmount).toBeCloseTo(expectedNewPrincipal, 2);
    }
  });

  it("two early repayments landing on the same date: the second is computed against the balance left by the first", () => {
    const issueDate = new Date(2024, 0, 15);
    const earlyDate = new Date(2024, 1, 10); // strictly before the 2024-02-15 regular payment
    const principal = 1_200_000;

    const interestForFirst = calculateAccruedInterest({
      principal,
      annualInterestRatePercent: 12,
      dayCountBasis: "ACTUAL_365",
      fromDate: issueDate,
      toDate: earlyDate,
      roundingDecimals: 2,
    });

    const { schedule } = generateLoanSchedule({
      principal,
      annualInterestRatePercent: 12,
      loanType: "ANNUITY",
      termMonths: 24,
      issueDate,
      earlyRepayments: [
        {
          earlyRepaymentDateStart: earlyDate,
          earlyRepaymentAmount: 50_000,
          periodicity: "ONCE",
        },
        {
          earlyRepaymentDateStart: earlyDate,
          earlyRepaymentAmount: 50_000,
          periodicity: "ONCE",
        },
      ],
    });

    const earlyEntries = schedule.filter((e) => e.isEarlyRepayment);
    expect(earlyEntries).toHaveLength(2);

    const principalPaidFirst = round2(50_000 - interestForFirst);
    // Second repayment lands on the same day as the first (0 days elapsed) => zero extra interest.
    expect(earlyEntries[1].interestAmount).toBe(0);
    expect(earlyEntries[1].principalAmount).toBeCloseTo(50_000, 2);

    const expectedFinalRemaining = round2(
      principal - principalPaidFirst - 50_000
    );
    expect(earlyEntries[1].remainingPrincipal).toBeCloseTo(expectedFinalRemaining, 2);
  });
});

describe("generateLoanSchedule - AMORTIZATION + DECREASE_TERM (new symmetric behavior)", () => {
  it("DECREASE_TERM shortens the remaining term instead of only lowering the payment", () => {
    const issueDate = new Date(2024, 0, 15);
    const { schedule: baselineSchedule } = generateLoanSchedule({
      principal: 240_000,
      annualInterestRatePercent: 12,
      loanType: "AMORTIZATION",
      termMonths: 12,
      issueDate: new Date(issueDate),
    });
    const remainingAfter2 = baselineSchedule[1].remainingPrincipal;
    const amortizationPrincipal = 20_000;

    // After 2 regular payments (Feb15, Mar15), period 3's window is [Mar15, Apr15).
    const earlyDate = new Date(2024, 3, 10); // before period-3's 2024-04-15 payment
    const accrued = calculateAccruedInterest({
      principal: remainingAfter2,
      annualInterestRatePercent: 12,
      dayCountBasis: "ACTUAL_365",
      fromDate: new Date(2024, 2, 15),
      toDate: earlyDate,
      roundingDecimals: 2,
    });
    const repaymentAmount = 40_000;
    const principalPaid = round2(repaymentAmount - accrued);
    const expectedReduction = calculateAmortizationMonthsReduction({
      principalAmountPaid: principalPaid,
      remainingPrincipal: remainingAfter2,
      amortizationPrincipal,
    });
    expect(expectedReduction).toBeGreaterThan(0);

    const { schedule } = generateLoanSchedule({
      principal: 240_000,
      annualInterestRatePercent: 12,
      loanType: "AMORTIZATION",
      termMonths: 12,
      issueDate: new Date(issueDate),
      earlyRepayments: [
        {
          earlyRepaymentDateStart: earlyDate,
          earlyRepaymentAmount: repaymentAmount,
          periodicity: "ONCE",
          repaymentType: "DECREASE_TERM",
        },
      ],
    });

    const regularEntries = schedule.filter((e) => !e.isEarlyRepayment);
    expect(regularEntries).toHaveLength(12 - expectedReduction);
    for (const entry of regularEntries.slice(0, -1)) {
      expect(entry.principalAmount).toBeCloseTo(amortizationPrincipal, 2);
    }
  });

  it("DECREASE_PAYMENT keeps the term and lowers the per-period principal instead", () => {
    const issueDate = new Date(2024, 0, 15);
    const { schedule: baselineSchedule } = generateLoanSchedule({
      principal: 240_000,
      annualInterestRatePercent: 12,
      loanType: "AMORTIZATION",
      termMonths: 12,
      issueDate: new Date(issueDate),
    });
    const remainingAfter2 = baselineSchedule[1].remainingPrincipal;

    const earlyDate = new Date(2024, 3, 10); // period 3's window is [Mar15, Apr15)
    const accrued = calculateAccruedInterest({
      principal: remainingAfter2,
      annualInterestRatePercent: 12,
      dayCountBasis: "ACTUAL_365",
      fromDate: new Date(2024, 2, 15),
      toDate: earlyDate,
      roundingDecimals: 2,
    });
    const repaymentAmount = 40_000;
    const principalPaid = round2(repaymentAmount - accrued);
    const remainingAfterRepayment = round2(remainingAfter2 - principalPaid);
    const expectedNewPrincipal = recalculateAmortizationPrincipal({
      remainingPrincipal: remainingAfterRepayment,
      periodsRemaining: 10, // 12 - 2 periods already paid
      roundingDecimals: 2,
    });

    const { schedule } = generateLoanSchedule({
      principal: 240_000,
      annualInterestRatePercent: 12,
      loanType: "AMORTIZATION",
      termMonths: 12,
      issueDate: new Date(issueDate),
      earlyRepayments: [
        {
          earlyRepaymentDateStart: earlyDate,
          earlyRepaymentAmount: repaymentAmount,
          periodicity: "ONCE",
          repaymentType: "DECREASE_PAYMENT",
        },
      ],
    });

    const regularEntries = schedule.filter((e) => !e.isEarlyRepayment);
    expect(regularEntries).toHaveLength(12);
    for (const entry of regularEntries.slice(2, -1)) {
      expect(entry.principalAmount).toBeCloseTo(expectedNewPrincipal, 2);
    }
  });
});

describe("generateLoanSchedule - recurring early repayments", () => {
  it("MONTHLY periodicity applies on each expected date without duplication or skips", () => {
    const { schedule } = generateLoanSchedule({
      principal: 900_000,
      annualInterestRatePercent: 12,
      loanType: "ANNUITY",
      termMonths: 24,
      issueDate: new Date(2024, 0, 15),
      earlyRepayments: [
        {
          earlyRepaymentDateStart: new Date(2024, 1, 10),
          earlyRepaymentAmount: 5000,
          periodicity: "MONTHLY",
          repaymentType: "DECREASE_TERM",
        },
      ],
    });

    const earlyEntries = schedule.filter((e) => e.isEarlyRepayment).slice(0, 3);
    expect(earlyEntries.map((e) => localDate(e.paymentDate))).toEqual([
      "2024-02-10",
      "2024-03-10",
      "2024-04-10",
    ]);

    let prevRemaining = Infinity;
    for (const entry of earlyEntries) {
      expect(entry.remainingPrincipal).toBeLessThan(prevRemaining);
      prevRemaining = entry.remainingPrincipal;
    }
  });

  it("stops applying once earlyRepaymentDateEnd has passed, still applying on the boundary date itself", () => {
    const { schedule } = generateLoanSchedule({
      principal: 900_000,
      annualInterestRatePercent: 12,
      loanType: "ANNUITY",
      termMonths: 24,
      issueDate: new Date(2024, 0, 15),
      earlyRepayments: [
        {
          earlyRepaymentDateStart: new Date(2024, 1, 10),
          earlyRepaymentDateEnd: new Date(2024, 3, 10),
          earlyRepaymentAmount: 5000,
          periodicity: "MONTHLY",
          repaymentType: "DECREASE_TERM",
        },
      ],
    });

    const earlyEntries = schedule.filter((e) => e.isEarlyRepayment);
    expect(earlyEntries.map((e) => localDate(e.paymentDate))).toEqual([
      "2024-02-10",
      "2024-03-10",
      "2024-04-10",
    ]);
  });
});

describe("generateLoanSchedule - syncWithPaymentDate", () => {
  // paymentDayNumber 16 with moveHolidayToNextDay lands on a weekend in
  // March 2024 (2024-03-16 is a Saturday), so the loan's own regular
  // payment date shifts to 2024-03-18. This is exactly the scenario the
  // flag exists for: a recurring early repayment must follow that shift
  // too, or it silently drifts away from the actual payment date.
  const baseParams = {
    principal: 900_000,
    annualInterestRatePercent: 12,
    loanType: "ANNUITY" as const,
    termMonths: 12,
    issueDate: new Date(2024, 0, 16),
    paymentDayNumber: 16,
    moveHolidayToNextDay: true,
  };

  it("keeps a recurring early repayment locked to the actual (weekend-shifted) payment date", () => {
    const { schedule: baseline } = generateLoanSchedule({ ...baseParams });
    const regularDates = baseline.map((e) => localDate(e.paymentDate));

    const { schedule } = generateLoanSchedule({
      ...baseParams,
      earlyRepayments: [
        {
          // Deliberately picked on a different day-of-month than 16, to
          // prove syncWithPaymentDate overrides it rather than drifting
          // from its own independent calendar arithmetic.
          earlyRepaymentDateStart: new Date(2024, 1, 1),
          earlyRepaymentAmount: 10_000,
          periodicity: "MONTHLY",
          repaymentType: "DECREASE_PAYMENT",
          syncWithPaymentDate: true,
        },
      ],
    });

    const earlyEntries = schedule.filter((e) => e.isEarlyRepayment);
    expect(earlyEntries.length).toBeGreaterThan(3);
    for (const entry of earlyEntries) {
      // Every synced early repayment must land exactly on one of the
      // loan's own regular payment dates, including the March shift.
      expect(regularDates).toContain(localDate(entry.paymentDate));
      // ...and therefore accrue zero extra interest (it's simultaneous
      // with the regular payment already covering that period).
      expect(entry.interestAmount).toBe(0);
    }

    const marchEntry = earlyEntries.find((e) => e.paymentDate.getMonth() === 2)!;
    expect(marchEntry.paymentDate.getDate()).toBe(18);
  });

  it("without the flag, the same recurring repayment drifts off the shifted payment date", () => {
    const { schedule } = generateLoanSchedule({
      ...baseParams,
      earlyRepayments: [
        {
          earlyRepaymentDateStart: new Date(2024, 1, 16),
          earlyRepaymentAmount: 10_000,
          periodicity: "MONTHLY",
          repaymentType: "DECREASE_PAYMENT",
          // syncWithPaymentDate intentionally omitted
        },
      ],
    });

    const marchEntry = schedule
      .filter((e) => e.isEarlyRepayment)
      .find((e) => e.paymentDate.getMonth() === 2)!;

    // Raw calendar arithmetic keeps it on the 16th (a Saturday) instead of
    // following the loan's actual 18th (Monday) payment date.
    expect(marchEntry.paymentDate.getDate()).toBe(16);
    // Landing a couple of days before the real (shifted) payment means it
    // still accrues real interest, unlike the synced version above.
    expect(marchEntry.interestAmount).toBeGreaterThan(0);
  });
});
