import {
  addMonths,
  differenceInCalendarDays,
  getDaysInMonth,
  isLeapYear,
  isWeekend,
  nextMonday,
} from "date-fns";

export interface EarlyRepaymentParams {
  earlyRepaymentDateStart: Date | string;
  earlyRepaymentDateEnd?: Date | string;
  periodicity?: "ONCE" | "MONTHLY" | "QUARTERLY" | "YEARLY";
  earlyRepaymentAmount?: number;
  repaymentType?: "DECREASE_TERM" | "DECREASE_PAYMENT";
}

export interface EarlyRepaymentRecord extends EarlyRepaymentParams {
  id: number;
  earlyRepaymentDateStart: Date;
  earlyRepaymentDateEnd?: Date;
  earlyRepaymentDate: Date;
}

export interface LoanScheduleParams {
  principal: number;
  annualInterestRatePercent: number;
  loanType: "ANNUITY" | "AMORTIZATION";
  termMonths: number;
  issueDate: Date;
  paymentDayNumber?: number;
  interestOnlyFirstPeriod?: boolean;
  moveHolidayToNextDay?: boolean;
  dayCountBasis?: "ACTUAL_365" | "ACTUAL_360" | "ACTUAL_ACTUAL";
  /** Number of fractional digits to round monetary amounts to. Defaults to 2. */
  roundingDecimals?: number;
  earlyRepayments?: EarlyRepaymentParams[];
}

export interface LoanCalcSharedParams {
  readonly loanType: "ANNUITY" | "AMORTIZATION";
  readonly roundingDecimals: number;
  readonly dayCountBasis: "ACTUAL_365" | "ACTUAL_360" | "ACTUAL_ACTUAL";
  readonly annualInterestRatePercent: number;
  previousDate: Date;
  currentDate: Date;
  nextDate: Date;
  termMonthsToCalculate: number;
  remainingPrincipal: number;
  monthlyInterestRate: number;
  amortizationPrincipal: number;
  annuityMonthlyPayment: number;
  remainingInterestAmount: number;
}

export interface LoanScheduleEntry {
  paymentDate: Date;
  paymentAmount: number;
  interestAmount: number;
  principalAmount: number;
  remainingPrincipal: number;
  isEarlyRepayment?: boolean;
}

export function generateLoanSchedule(params: LoanScheduleParams): {
  schedule: LoanScheduleEntry[];
  startMonthlyPayment: number;
} {
  const schedule: LoanScheduleEntry[] = [];

  const {
    principal,
    annualInterestRatePercent,
    termMonths,
    issueDate,
    loanType = "ANNUITY",
    interestOnlyFirstPeriod = false,
    dayCountBasis = "ACTUAL_365",
    roundingDecimals = 2,
    earlyRepayments = [],
    moveHolidayToNextDay = false,
  } = params;
  issueDate.setHours(0, 0, 0, 0);

  if (principal <= 0) throw new Error("principal must be > 0");
  if (termMonths <= 0) throw new Error("termMonths must be > 0");
  if (annualInterestRatePercent < 0)
    throw new Error("annualInterestRatePercent must be >= 0");

  const earlyRepaymentRecords: Record<number, EarlyRepaymentRecord> = {};
  earlyRepayments.forEach((earlyRepayment, index) => {
    earlyRepaymentRecords[index] = {
      ...earlyRepayment,
      id: index,
      earlyRepaymentDateStart: new Date(earlyRepayment.earlyRepaymentDateStart),
      earlyRepaymentDateEnd: earlyRepayment.earlyRepaymentDateEnd
        ? new Date(earlyRepayment.earlyRepaymentDateEnd)
        : undefined,
      earlyRepaymentDate: new Date(earlyRepayment.earlyRepaymentDateStart),
    };
  });

  const paymentDayNumber = params.paymentDayNumber ?? issueDate.getDate();
  const termMonthsToCalculate = interestOnlyFirstPeriod
    ? termMonths - 1
    : termMonths;
  let sharedParams: LoanCalcSharedParams = {
    loanType,
    previousDate: issueDate,
    currentDate: issueDate,
    nextDate: moveToNextDate(issueDate, paymentDayNumber, moveHolidayToNextDay),
    remainingPrincipal: principal,
    termMonthsToCalculate,
    monthlyInterestRate: annualInterestRatePercent / 12 / 100,
    annualInterestRatePercent,
    amortizationPrincipal: principal / termMonthsToCalculate,
    annuityMonthlyPayment: calculateAnnuityMonthlyPayment({
      principal,
      monthlyInterestRate: annualInterestRatePercent / 12 / 100,
      termMonths: termMonthsToCalculate,
      roundingDecimals,
    }),
    remainingInterestAmount: 0,
    roundingDecimals,
    dayCountBasis,
  };

  const startMonthlyPayment =
    loanType === "ANNUITY"
      ? sharedParams.annuityMonthlyPayment
      : sharedParams.amortizationPrincipal;

  let remainingTermMonths = termMonths;

  while (remainingTermMonths > 0) {
    sharedParams.remainingInterestAmount = 0;
    const nextEarlyRepayment = getNextEarlyRepayment(
      earlyRepaymentRecords,
      sharedParams.currentDate,
      sharedParams.nextDate
    );

    if (nextEarlyRepayment.length > 0) {
      const {
        updatedSharedParams,
        loanSchedule,
        deletedEarlyRepayments,
        updatedEarlyRepayments,
      } = applyEarlyRepayments(sharedParams, nextEarlyRepayment);
      sharedParams = updatedSharedParams;
      schedule.push(...loanSchedule);

      if (deletedEarlyRepayments.length > 0) {
        for (const deletedEarlyRepayment of deletedEarlyRepayments) {
          delete earlyRepaymentRecords[deletedEarlyRepayment.id];
        }
      }
      if (updatedEarlyRepayments.length > 0) {
        for (const updatedEarlyRepayment of updatedEarlyRepayments) {
          earlyRepaymentRecords[updatedEarlyRepayment.id] =
            updatedEarlyRepayment;
        }
      }
    }

    if (sharedParams.remainingPrincipal <= 0) {
      break;
    }

    const dayDifference = differenceInCalendarDays(
      sharedParams.nextDate,
      sharedParams.currentDate
    );
    const { daysInYear } = getMonthDaysAndYearDays(
      sharedParams.nextDate,
      dayCountBasis
    );
    const interestAmount =
      sharedParams.remainingInterestAmount != 0
        ? sharedParams.remainingInterestAmount
        : roundDecimals(
            sharedParams.remainingPrincipal *
              (annualInterestRatePercent / 100 / daysInYear) *
              dayDifference,
            roundingDecimals
          );

    if (remainingTermMonths === termMonths && interestOnlyFirstPeriod) {
      schedule.push({
        paymentDate: sharedParams.nextDate,
        paymentAmount: interestAmount,
        interestAmount: interestAmount,
        principalAmount: 0,
        remainingPrincipal: sharedParams.remainingPrincipal,
      });
      sharedParams.previousDate = sharedParams.currentDate;
      sharedParams.currentDate = sharedParams.nextDate;
      sharedParams.nextDate = moveToNextDate(
        sharedParams.currentDate,
        paymentDayNumber,
        moveHolidayToNextDay
      );
      remainingTermMonths = remainingTermMonths - 1;
      continue;
    }

    if (
      remainingTermMonths === 1 ||
      (loanType === "ANNUITY" &&
        sharedParams.remainingPrincipal <= sharedParams.annuityMonthlyPayment)
    ) {
      schedule.push({
        paymentDate: sharedParams.nextDate,
        paymentAmount: roundDecimals(
          sharedParams.remainingPrincipal + interestAmount,
          roundingDecimals
        ),
        interestAmount,
        principalAmount: sharedParams.remainingPrincipal,
        remainingPrincipal: 0,
      });
      break;
    }

    if (loanType === "ANNUITY") {
      const principalAmount = roundDecimals(
        sharedParams.annuityMonthlyPayment - interestAmount,
        roundingDecimals
      );
      sharedParams.remainingPrincipal = roundDecimals(
        sharedParams.remainingPrincipal - principalAmount,
        roundingDecimals
      );
      schedule.push({
        paymentDate: sharedParams.nextDate,
        paymentAmount: sharedParams.annuityMonthlyPayment,
        interestAmount: interestAmount,
        principalAmount: principalAmount,
        remainingPrincipal: sharedParams.remainingPrincipal,
      });
    } else {
      sharedParams.remainingPrincipal = roundDecimals(
        sharedParams.remainingPrincipal - sharedParams.amortizationPrincipal,
        roundingDecimals
      );

      const paymentAmount = roundDecimals(
        sharedParams.amortizationPrincipal + interestAmount,
        roundingDecimals
      );
      schedule.push({
        paymentDate: sharedParams.nextDate,
        paymentAmount,
        interestAmount: interestAmount,
        principalAmount: sharedParams.amortizationPrincipal,
        remainingPrincipal: sharedParams.remainingPrincipal,
      });
    }

    sharedParams.previousDate = sharedParams.currentDate;
    sharedParams.currentDate = sharedParams.nextDate;
    sharedParams.nextDate = moveToNextDate(
      sharedParams.currentDate,
      paymentDayNumber,
      moveHolidayToNextDay
    );
    remainingTermMonths = remainingTermMonths - 1;
  }

  return {
    schedule,
    startMonthlyPayment,
  };
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

export function calculateAnnuityMonthlyPayment(dto: {
  principal: number;
  monthlyInterestRate: number;
  termMonths: number;
  roundingDecimals: number;
}): number {
  const { principal, monthlyInterestRate, termMonths, roundingDecimals } = dto;
  return roundDecimals(
    (principal *
      monthlyInterestRate *
      Math.pow(1 + monthlyInterestRate, termMonths)) /
      (Math.pow(1 + monthlyInterestRate, termMonths) - 1),
    roundingDecimals
  );
}

export function getMonthDaysAndYearDays(
  paymentDate: Date,
  dayCountBasis: "ACTUAL_365" | "ACTUAL_360" | "ACTUAL_ACTUAL"
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

export function roundDecimals(value: number, decimals: number): number {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

function getNextEarlyRepayment(
  earlyRepaymentRecords: Record<number, EarlyRepaymentRecord>,
  currentDate: Date,
  nextDate: Date
): EarlyRepaymentRecord[] {
  if (Object.keys(earlyRepaymentRecords).length === 0) {
    return [];
  }
  const earlyRepayments = Object.values(earlyRepaymentRecords);
  const orderByDate = (a: EarlyRepaymentRecord, b: EarlyRepaymentRecord) => {
    return a.earlyRepaymentDate.getTime() - b.earlyRepaymentDate.getTime();
  };
  const onceEarlyRepayments = earlyRepayments
    .filter((earlyRepayment) => {
      return earlyRepayment.periodicity === "ONCE";
    })
    .sort(orderByDate);
  const monthlyEarlyRepayments = earlyRepayments
    .filter((earlyRepayment) => {
      return earlyRepayment.periodicity === "MONTHLY";
    })
    .sort(orderByDate);
  const quarterlyEarlyRepayments = earlyRepayments
    .filter((earlyRepayment) => {
      return earlyRepayment.periodicity === "QUARTERLY";
    })
    .sort(orderByDate);
  const yearlyEarlyRepayments = earlyRepayments
    .filter((earlyRepayment) => {
      return earlyRepayment.periodicity === "YEARLY";
    })
    .sort(orderByDate);

  const nextRepayments = [
    onceEarlyRepayments[0],
    monthlyEarlyRepayments[0],
    quarterlyEarlyRepayments[0],
    yearlyEarlyRepayments[0],
  ]
    .filter((earlyRepayment) => {
      if (!earlyRepayment) {
        return false;
      }

      if (
        earlyRepayment.earlyRepaymentDateEnd &&
        currentDate > earlyRepayment.earlyRepaymentDateEnd
      ) {
        return false;
      }

      return (
        currentDate < earlyRepayment.earlyRepaymentDate &&
        nextDate >= earlyRepayment.earlyRepaymentDate
      );
    })
    .sort(orderByDate);

  return nextRepayments;
}

function applyEarlyRepayments(
  sharedParams: LoanCalcSharedParams,
  orderedEarlyRepayments: EarlyRepaymentRecord[]
): {
  updatedSharedParams: LoanCalcSharedParams;
  loanSchedule: LoanScheduleEntry[];
  deletedEarlyRepayments: EarlyRepaymentRecord[];
  updatedEarlyRepayments: EarlyRepaymentRecord[];
} {
  let updatedSharedParams = { ...sharedParams };
  const deletedEarlyRepayments = [];
  const updatedEarlyRepayments = [];
  const loanSchedule = [];

  for (const earlyRepayment of orderedEarlyRepayments) {
    const result = applyEarlyRepayment(sharedParams, earlyRepayment);
    updatedSharedParams = result.updatedSharedParams;
    loanSchedule.push(...result.loanSchedule);
    if (updatedSharedParams.remainingPrincipal <= 0) {
      updatedSharedParams.remainingPrincipal = 0;
      break;
    }
    if (result.deleteEarlyRepayment) {
      deletedEarlyRepayments.push(earlyRepayment);
    }
    if (result.updatedEarlyRepayment) {
      updatedEarlyRepayments.push(result.updatedEarlyRepayment);
    }
  }

  return {
    updatedSharedParams,
    loanSchedule,
    deletedEarlyRepayments,
    updatedEarlyRepayments,
  };
}

function applyEarlyRepayment(
  sharedParams: LoanCalcSharedParams,
  earlyRepayment: EarlyRepaymentRecord
): {
  updatedSharedParams: LoanCalcSharedParams;
  loanSchedule: LoanScheduleEntry[];
  deleteEarlyRepayment: boolean;
  updatedEarlyRepayment?: EarlyRepaymentRecord;
} {
  if (sharedParams.remainingPrincipal <= 0) {
    return {
      updatedSharedParams: sharedParams,
      loanSchedule: [],
      deleteEarlyRepayment: false,
    };
  }

  let updatedSharedParams = { ...sharedParams };
  const loanSchedule: LoanScheduleEntry[] = [];
  let deleteEarlyRepayment = false;
  let updatedEarlyRepayment = earlyRepayment;

  const dayDifference = differenceInCalendarDays(
    earlyRepayment.earlyRepaymentDate,
    sharedParams.currentDate
  );
  const { daysInYear } = getMonthDaysAndYearDays(
    earlyRepayment.earlyRepaymentDate,
    sharedParams.dayCountBasis
  );
  const interestAmount = roundDecimals(
    sharedParams.remainingPrincipal *
      (sharedParams.annualInterestRatePercent / 100 / daysInYear) *
      dayDifference,
    sharedParams.roundingDecimals
  );

  if (earlyRepayment.earlyRepaymentAmount <= interestAmount) {
    updatedSharedParams.remainingInterestAmount = roundDecimals(
      interestAmount - earlyRepayment.earlyRepaymentAmount,
      sharedParams.roundingDecimals
    );

    loanSchedule.push({
      paymentDate: earlyRepayment.earlyRepaymentDate,
      paymentAmount: earlyRepayment.earlyRepaymentAmount,
      interestAmount: earlyRepayment.earlyRepaymentAmount,
      principalAmount: 0,
      remainingPrincipal: sharedParams.remainingPrincipal,
      isEarlyRepayment: true,
    });
  } else {
    let paymentAmount = earlyRepayment.earlyRepaymentAmount;
    let principalAmount = roundDecimals(
      earlyRepayment.earlyRepaymentAmount - interestAmount,
      sharedParams.roundingDecimals
    );

    updatedSharedParams.remainingPrincipal = roundDecimals(
      updatedSharedParams.remainingPrincipal - principalAmount,
      sharedParams.roundingDecimals
    );

    if (updatedSharedParams.remainingPrincipal < 0) {
      principalAmount =
        principalAmount + updatedSharedParams.remainingPrincipal;
      paymentAmount = paymentAmount + updatedSharedParams.remainingPrincipal;
      updatedSharedParams.remainingPrincipal = 0;
    }
    loanSchedule.push({
      paymentDate: earlyRepayment.earlyRepaymentDate,
      paymentAmount,
      interestAmount,
      principalAmount,
      remainingPrincipal: updatedSharedParams.remainingPrincipal,
      isEarlyRepayment: true,
    });
  }

  if (
    sharedParams.loanType === "ANNUITY" &&
    earlyRepayment.repaymentType === "DECREASE_PAYMENT"
  ) {
    updatedSharedParams.annuityMonthlyPayment = calculateAnnuityMonthlyPayment({
      principal: updatedSharedParams.remainingPrincipal,
      monthlyInterestRate: sharedParams.monthlyInterestRate,
      termMonths: updatedSharedParams.termMonthsToCalculate,
      roundingDecimals: sharedParams.roundingDecimals,
    });
  }

  if (sharedParams.loanType === "AMORTIZATION") {
    updatedSharedParams.amortizationPrincipal = roundDecimals(
      updatedSharedParams.remainingPrincipal /
        updatedSharedParams.termMonthsToCalculate,
      sharedParams.roundingDecimals
    );
  }

  updatedSharedParams.previousDate = updatedSharedParams.currentDate;
  updatedSharedParams.currentDate = earlyRepayment.earlyRepaymentDate;

  switch (earlyRepayment.periodicity) {
    case "ONCE":
      deleteEarlyRepayment = true;
      updatedEarlyRepayment = undefined;
      break;
    case "MONTHLY":
      updatedEarlyRepayment.earlyRepaymentDate = addMonths(
        earlyRepayment.earlyRepaymentDate,
        1
      );
      break;
    case "QUARTERLY":
      updatedEarlyRepayment.earlyRepaymentDate = addMonths(
        earlyRepayment.earlyRepaymentDate,
        3
      );
      break;
    case "YEARLY":
      updatedEarlyRepayment.earlyRepaymentDate = addMonths(
        earlyRepayment.earlyRepaymentDate,
        12
      );
      break;
  }
  
  if (
    updatedEarlyRepayment &&
    updatedEarlyRepayment.earlyRepaymentDate < updatedSharedParams.nextDate
  ) {
    const nextRepayment = applyEarlyRepayment(
      updatedSharedParams,
      updatedEarlyRepayment
    );
    loanSchedule.push(...nextRepayment.loanSchedule);
    updatedSharedParams = nextRepayment.updatedSharedParams;
    deleteEarlyRepayment = nextRepayment.deleteEarlyRepayment;
    updatedEarlyRepayment = nextRepayment.updatedEarlyRepayment;
  }

  if (
    updatedEarlyRepayment &&
    updatedEarlyRepayment.earlyRepaymentDate >
      updatedEarlyRepayment.earlyRepaymentDateEnd
  ) {
    deleteEarlyRepayment = true;
    updatedEarlyRepayment = undefined;
  }

  return {
    updatedSharedParams,
    loanSchedule,
    deleteEarlyRepayment,
    updatedEarlyRepayment,
  };
}
