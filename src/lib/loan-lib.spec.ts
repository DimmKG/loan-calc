import { differenceInMonths } from "date-fns";
import { describe, expect, it } from "vitest";
import { generateLoanSchedule } from "./loan-lib";
import {
  calculateAccruedInterest,
  calculateAmortizationMonthsReduction,
  calculateAnnuityMonthlyPayment,
  calculateAnnuityPaymentForSchedule,
  calculateMonthsReduction,
  recalculateAmortizationPrincipal,
} from "./loan-schedule-helpers";

const round2 = (n: number) => Math.round(n * 100) / 100;
const sum = (values: number[]) => round2(values.reduce((a, b) => a + b, 0));
// Форматтер локальной даты: значения paymentDate создаются/сравниваются с
// использованием локальных геттеров во всём приложении, поэтому toISOString()
// (основанный на UTC) может неверно определить день, если у тестового
// раннера смещение часового пояса отлично от нуля.
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
    // 1 льготный + 4 обычных = 5 всего, охватывающих 5 месяцев с даты выдачи
    // (льготный месяц засчитывается как один из 6 заявленных termMonths, а
    // не добавляет 6-й месяц сверху).
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
    // 1 льготный + 5 обычных = 6 всего, охватывающих 6 месяцев с даты выдачи -
    // на месяц больше, чем в новом (поведении по умолчанию) выше.
    expect(schedule).toHaveLength(6);
    expect(
      differenceInMonths(schedule[schedule.length - 1].paymentDate, issueDate)
    ).toBe(6);
  });

  it("large long-term loan: interest-only + weekend shift together still avoid the extra month", () => {
    // Кредит на 15 лет, первый месяц льготный, день платежа подобран так,
    // чтобы самый первый обычный платёж попал на субботу и должен сдвинуться.
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

    // Первый платёж: issueDate переносится на 20-е число, затем +1 месяц =
    // 2024-04-20, суббота -> сдвигается на понедельник 2024-04-22.
    expect(schedule[0].paymentDate.getFullYear()).toBe(2024);
    expect(schedule[0].paymentDate.getMonth()).toBe(3); // Апрель
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

    // Без +1 месяца: общий охват должен укладываться в 1 месяц от
    // termMonths-1 (аннуитетный платёж здесь использует плоскую месячную
    // ставку annualRate/12, а не точную амортизацию по дням, поэтому
    // сокращение "remainingPrincipal <= annuityMonthlyPayment" при досрочном
    // погашении может законно сдвинуть финальный платёж-лямпсум на месяц
    // раньше теоретического значения) - и должен оставаться заметно короче
    // старого (до фикса) охвата termMonths.
    const lastPayment = schedule[schedule.length - 1];
    const monthsElapsed = differenceInMonths(lastPayment.paymentDate, issueDate);
    expect(monthsElapsed).toBeGreaterThanOrEqual(termMonths - 2);
    expect(monthsElapsed).toBeLessThanOrEqual(termMonths - 1);
    expect(lastPayment.remainingPrincipal).toBe(0);
  });

  it("regression: long-term ANNUITY loan does not dump a balloon payment at the end", () => {
    // По умолчанию аннуитетный платёж подбирается методом goal-seek
    // (fullInterestModeling: true): он вычисляется по реальным датам
    // оставшихся периодов и реальным процентам с учётом дней, поэтому график
    // должен амортизироваться почти точно до нуля к номинальному сроку - а не
    // давать недостачу в несколько платежей, которую производила старая
    // формула с плоской ставкой (rate/12 для каждого периода) за 30-летний
    // срок. График должен укладываться в номинальный срок (или отличаться от
    // него не более чем на один платёж), а последний платёж должен быть
    // очень близок к обычному.
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
    expect(schedule.length).toBeLessThanOrEqual(termMonths + 1);
    // Последний платёж - это "всё, что осталось" (тело долга + проценты за
    // последний период), он не обязан совпадать с обычным платежом - но при
    // точно подобранном (goal-seek) платеже он должен отличаться от обычного
    // на доли процента, а не давать те 50%+ balloon-платежа, которые
    // производила старая формула с плоской ставкой.
    expect(lastPayment.paymentAmount).toBeGreaterThan(startMonthlyPayment * 0.99);
    expect(lastPayment.paymentAmount).toBeLessThan(startMonthlyPayment * 1.01);
  });

  it("fullInterestModeling: false reproduces the old flat-rate closed-form payment exactly", () => {
    const issueDate = new Date(2020, 0, 15);
    const paymentDayNumber = 15;
    const termMonths = 360;
    const { startMonthlyPayment } = generateLoanSchedule({
      principal: 6_000_000,
      annualInterestRatePercent: 7,
      loanType: "ANNUITY",
      termMonths,
      issueDate: new Date(issueDate),
      paymentDayNumber,
      dayCountBasis: "ACTUAL_365",
      fullInterestModeling: false,
    });

    const closedFormPayment = calculateAnnuityMonthlyPayment({
      principal: 6_000_000,
      monthlyInterestRate: 7 / 12 / 100,
      termMonths,
      roundingDecimals: 2,
    });
    expect(startMonthlyPayment).toBe(closedFormPayment);
  });

  it("interestModelingHorizonMonths: a short horizon lands strictly between full goal-seek and the flat closed-form payment", () => {
    const issueDate = new Date(2020, 0, 15);
    const paymentDayNumber = 15;
    const termMonths = 240;
    const commonParams = {
      principal: 4_000_000,
      annualInterestRatePercent: 8,
      loanType: "ANNUITY" as const,
      termMonths,
      issueDate: new Date(issueDate),
      paymentDayNumber,
      dayCountBasis: "ACTUAL_365" as const,
    };

    const fullGoalSeek = generateLoanSchedule({
      ...commonParams,
      issueDate: new Date(issueDate),
    }).startMonthlyPayment;
    const closedForm = generateLoanSchedule({
      ...commonParams,
      issueDate: new Date(issueDate),
      fullInterestModeling: false,
    }).startMonthlyPayment;
    const hybrid = generateLoanSchedule({
      ...commonParams,
      issueDate: new Date(issueDate),
      interestModelingHorizonMonths: 12,
    }).startMonthlyPayment;

    expect(fullGoalSeek).not.toBe(closedForm);
    expect(hybrid).not.toBe(fullGoalSeek);
    expect(hybrid).not.toBe(closedForm);
    expect(hybrid).toBeGreaterThan(Math.min(fullGoalSeek, closedForm));
    expect(hybrid).toBeLessThan(Math.max(fullGoalSeek, closedForm));
  });

  it("moveHolidayToNextDay: a weekend payment date shifts to the following Monday", () => {
    // paymentDayNumber 16, 2024-03-16 - суббота
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

    // недостача должна быть перенесена в проценты следующего обычного платежа
    const nextRegular = schedule.find((e) => !e.isEarlyRepayment)!;
    const expectedCarriedInterest = round2(accrued - round2(accrued / 2));
    expect(nextRegular.interestAmount).toBeGreaterThanOrEqual(expectedCarriedInterest);
  });
});

describe("generateLoanSchedule - DECREASE_TERM strictly before the next regular date", () => {
  it("ANNUITY: term shrinks by the hand-computed reduction; only the very next payment is reduced by the delayed interest, then it reverts", () => {
    const issueDate = new Date(2024, 0, 15);
    const baseline = generateLoanSchedule({
      principal: 1_200_000,
      annualInterestRatePercent: 12,
      loanType: "ANNUITY",
      termMonths: 24,
      issueDate: new Date(issueDate),
    });
    const startPayment = baseline.startMonthlyPayment;
    const remainingBeforeRepayment = baseline.schedule[1].remainingPrincipal; // после 2 обычных платежей

    // После 2 обычных платежей (15 фев, 15 мар) окно currentDate/nextDate
    // в цикле для периода 3 - это [15 мар, 15 апр) - досрочка должна попасть
    // строго внутрь этого окна, чтобы применяться "до" собственного платежа периода 3.
    const earlyDate = new Date(2024, 3, 10); // до платежа периода 3 (2024-04-15)
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
    // Регулярный платёж сразу после DECREASE_TERM-досрочки, попавшей строго
    // до его даты, - это не просто startPayment: банк ещё возвращает
    // проценты, которые набежали бы на principalPaid между earlyDate и
    // датой платежа, ведь эта часть долга выбыла из тела кредита раньше,
    // чем закончился период.
    const nextRegularDate = new Date(2024, 3, 15);
    const delayedInterest = calculateAccruedInterest({
      principal: principalPaid,
      annualInterestRatePercent: 12,
      dayCountBasis: "ACTUAL_365",
      fromDate: earlyDate,
      toDate: nextRegularDate,
      roundingDecimals: 2,
    });
    const expectedAdjustedPayment = round2(startPayment - accrued - delayedInterest);

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
    // calculateMonthsReduction - непрерывная формула-приближение (с floor),
    // поэтому дискретный график с округлением до копейки может отличаться
    // от неё на 1 период.
    expect(regularEntries.length).toBeGreaterThanOrEqual(24 - expectedReduction - 1);
    expect(regularEntries.length).toBeLessThanOrEqual(24 - expectedReduction + 1);
    expect(regularEntries.length).toBeLessThan(24);
    // regularEntries[2] - первый платёж после досрочки (15 фев и 15 мар не
    // затронуты, 15 апр - это тот, что сразу после earlyDate).
    for (const entry of [...regularEntries.slice(0, 2), ...regularEntries.slice(3, -1)]) {
      expect(entry.paymentAmount).toBeCloseTo(startPayment, 2);
    }
    expect(regularEntries[2].paymentAmount).toBeCloseTo(expectedAdjustedPayment, 2);
  });

  it("регрессия: досрочки, попадающие за 1-2 дня до даты платежа, дают заниженный ближайший платёж, который затем возвращается к обычной сумме", () => {
    const { schedule } = generateLoanSchedule({
      principal: 8_913_212.0,
      annualInterestRatePercent: 6,
      loanType: "ANNUITY",
      termMonths: 360,
      issueDate: new Date(2025, 6, 23),
      paymentDayNumber: 20,
      moveHolidayToNextDay: true,
      dayCountBasis: "ACTUAL_ACTUAL",
      interestOnlyFirstPeriod: true,
      earlyRepayments: [
        { earlyRepaymentDateStart: new Date(2025, 7, 10), earlyRepaymentAmount: 45_000, repaymentType: "DECREASE_TERM", periodicity: "ONCE" },
        { earlyRepaymentDateStart: new Date(2025, 9, 20), earlyRepaymentAmount: 40_000, repaymentType: "DECREASE_TERM", periodicity: "ONCE" },
        { earlyRepaymentDateStart: new Date(2025, 10, 20), earlyRepaymentAmount: 37_448.23, repaymentType: "DECREASE_TERM", periodicity: "ONCE" },
        { earlyRepaymentDateStart: new Date(2025, 11, 22), earlyRepaymentAmount: 16_048, repaymentType: "DECREASE_TERM", periodicity: "ONCE" },
        { earlyRepaymentDateStart: new Date(2026, 0, 20), earlyRepaymentAmount: 146_448.84, repaymentType: "DECREASE_TERM", periodicity: "ONCE" },
        { earlyRepaymentDateStart: new Date(2026, 1, 18), earlyRepaymentAmount: 200_000, repaymentType: "DECREASE_TERM", periodicity: "ONCE" },
      ],
    });

    const regularEntries = schedule.filter((e) => !e.isEarlyRepayment);
    // Платёж №6 (20.01.2026): обычный период, правило близкой досрочки не действует.
    expect(regularEntries[5].principalAmount).toBeCloseTo(11_756.68, 1);
    expect(regularEntries[5].interestAmount).toBeCloseTo(41_794.9, 1);
    // Платёж №7 (20.02.2026): всего через 2 дня после досрочки на 200 000
    // (18.02.2026) - сумма намного меньше обычного аннуитета, потому что
    // банк возвращает проценты, которые набежали бы на списанную часть
    // долга до даты платежа, сверх уже учтённых при самой досрочке.
    expect(regularEntries[6].interestAmount).toBeCloseTo(2_778.13, 1);
    expect(regularEntries[6].principalAmount).toBeCloseTo(9_680.48, 1);
    expect(regularEntries[6].paymentAmount).toBeCloseTo(12_458.61, 1);
    // Платёж №8 (20.03.2026): снова обычная полная сумма.
    expect(regularEntries[7].paymentAmount).toBeCloseTo(53_551.58, 1);
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
          earlyRepaymentDateStart: new Date(2024, 6, 15), // ровно дата платежа периода 6
          earlyRepaymentAmount: repaymentAmount,
          periodicity: "ONCE",
          repaymentType: "DECREASE_PAYMENT",
        },
      ],
    });

    const earlyEntry = schedule.find((e) => e.isEarlyRepayment)!;
    // Дополнительные проценты не должны начисляться для досрочки, сделанной в тот же день, что и обычный платёж.
    expect(earlyEntry.interestAmount).toBe(0);
    expect(earlyEntry.principalAmount).toBeCloseTo(repaymentAmount, 2);

    const remainingAfterEarlyRepayment = round2(remainingAfter6 - repaymentAmount);
    expect(earlyEntry.remainingPrincipal).toBeCloseTo(remainingAfterEarlyRepayment, 2);

    // Правильный оставшийся срок после периода 6 = 24 - 6 = 18 (а не 19, как
    // было при ошибке off-by-one до фикса).
    // Платёж пересчитывается методом goal-seek (по умолчанию
    // fullInterestModeling: true) по реальным датам оставшихся периодов,
    // а не по плоской формульной ставке.
    const expectedNewPayment = calculateAnnuityPaymentForSchedule({
      principal: remainingAfterEarlyRepayment,
      annualInterestRatePercent: 12,
      dayCountBasis: "ACTUAL_365",
      // На дату nextDate - собственный платёж периода 6 уже произошёл; следующий
      // период начинается ИМЕННО с nextDate, а не месяцем позже.
      startDate: new Date(2024, 6, 15),
      paymentDayNumber: 15,
      moveHolidayToNextDay: false,
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
    // 6 уже оплачено + оставшийся сокращённый срок, +-1 из-за дискретного округления.
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
    const earlyDate = new Date(2024, 1, 10); // строго до обычного платежа 2024-02-15
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
    // Вторая досрочка приходится на тот же день, что и первая (прошло 0 дней) => дополнительных процентов нет.
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

    // После 2 обычных платежей (15 фев, 15 мар) окно периода 3 - [15 мар, 15 апр).
    const earlyDate = new Date(2024, 3, 10); // до платежа периода 3 (2024-04-15)
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

    const earlyDate = new Date(2024, 3, 10); // окно периода 3 - [15 мар, 15 апр)
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
      periodsRemaining: 10, // 12 - 2 уже оплаченных периода
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
  // paymentDayNumber 16 с moveHolidayToNextDay попадает на выходной в марте
  // 2024 (2024-03-16 - суббота), поэтому собственная дата обычного платежа
  // кредита сдвигается на 2024-03-18. Это именно тот сценарий, для которого
  // существует флаг: периодическая досрочка тоже должна следовать за этим
  // сдвигом, иначе она незаметно уходит от реальной даты платежа.
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
          // Намеренно выбрано число месяца, отличное от 16, чтобы доказать,
          // что syncWithPaymentDate переопределяет его, а не уходит в
          // сторону из-за собственной независимой календарной арифметики.
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
      // Каждая синхронизированная досрочка должна попадать точно на одну из
      // собственных дат обычных платежей кредита, включая мартовский сдвиг.
      expect(regularDates).toContain(localDate(entry.paymentDate));
      // ...и, следовательно, не должна начислять дополнительные проценты
      // (она совпадает по времени с обычным платежом, который уже покрывает этот период).
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
          // syncWithPaymentDate намеренно не указан
        },
      ],
    });

    const marchEntry = schedule
      .filter((e) => e.isEarlyRepayment)
      .find((e) => e.paymentDate.getMonth() === 2)!;

    // Простая календарная арифметика оставляет её на 16-м числе (суббота)
    // вместо того, чтобы следовать за реальной датой платежа кредита - 18-м (понедельник).
    expect(marchEntry.paymentDate.getDate()).toBe(16);
    // Попадание на пару дней раньше реального (сдвинутого) платежа означает,
    // что проценты всё же реально начисляются, в отличие от синхронизированной версии выше.
    expect(marchEntry.interestAmount).toBeGreaterThan(0);
  });
});
