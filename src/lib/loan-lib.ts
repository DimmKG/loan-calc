import {
  addMonths,
  differenceInCalendarDays,
  differenceInMonths,
  getDaysInMonth,
  isLeapYear,
  isSameDay,
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
  monthNumber: number;
  remainingTermMonths: number;
}

export interface LoanScheduleEntry {
  monthNumber: number;
  paymentDate: Date;
  paymentAmount: number;
  interestAmount: number;
  principalAmount: number;
  remainingPrincipal: number;
  isEarlyRepayment?: boolean;
}

export interface LoanScheduleResult {
  schedule: LoanScheduleEntry[];
  startMonthlyPayment: number;
}

export function generateLoanSchedule(
  params: LoanScheduleParams
): LoanScheduleResult {
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
    amortizationPrincipal: roundDecimals(
      principal / termMonthsToCalculate,
      roundingDecimals
    ),
    annuityMonthlyPayment: calculateAnnuityMonthlyPayment({
      principal,
      monthlyInterestRate: annualInterestRatePercent / 12 / 100,
      termMonths: termMonthsToCalculate,
      roundingDecimals,
    }),
    remainingInterestAmount: 0,
    roundingDecimals,
    dayCountBasis,
    monthNumber: 1,
    remainingTermMonths: termMonths,
  };

  const startMonthlyPayment =
    loanType === "ANNUITY"
      ? sharedParams.annuityMonthlyPayment
      : sharedParams.amortizationPrincipal;

  while (sharedParams.remainingTermMonths > 0) {
    sharedParams.remainingInterestAmount = 0;
    const nextEarlyRepayment = getNextEarlyRepayment(
      earlyRepaymentRecords,
      sharedParams.currentDate,
      sharedParams.nextDate
    );

    // Разделяем досрочные платежи на те, что до nextDate, и те, что в nextDate
    const earlyRepaymentsBeforeNextDate = nextEarlyRepayment.filter(
      (er) => !isSameDay(er.earlyRepaymentDate, sharedParams.nextDate)
    );
    const earlyRepaymentsOnNextDate = nextEarlyRepayment.filter((er) =>
      isSameDay(er.earlyRepaymentDate, sharedParams.nextDate)
    );

    // Сначала обрабатываем досрочные платежи, которые до nextDate
    if (earlyRepaymentsBeforeNextDate.length > 0) {
      const {
        updatedSharedParams,
        loanSchedule,
        deletedEarlyRepayments,
        updatedEarlyRepayments,
      } = applyEarlyRepayments(
        sharedParams,
        earlyRepaymentsBeforeNextDate,
        issueDate,
        paymentDayNumber
      );
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

    // Первый месяц - только проценты
    if (sharedParams.monthNumber === 1 && interestOnlyFirstPeriod) {
      schedule.push({
        monthNumber: calculateMonthNumber(
          sharedParams.nextDate,
          false,
          sharedParams.monthNumber,
          issueDate,
          paymentDayNumber
        ),
        paymentDate: sharedParams.nextDate,
        paymentAmount: interestAmount,
        interestAmount: interestAmount,
        principalAmount: 0,
        remainingPrincipal: sharedParams.remainingPrincipal,
      });

      // Обрабатываем досрочные платежи в тот же день после основного платежа
      const earlyRepaymentsOnNextDate = getNextEarlyRepayment(
        earlyRepaymentRecords,
        sharedParams.currentDate,
        sharedParams.nextDate
      ).filter((er) => isSameDay(er.earlyRepaymentDate, sharedParams.nextDate));

      if (earlyRepaymentsOnNextDate.length > 0) {
        const {
          updatedSharedParams,
          loanSchedule,
          deletedEarlyRepayments,
          updatedEarlyRepayments,
        } = applyEarlyRepayments(
          sharedParams,
          earlyRepaymentsOnNextDate,
          issueDate,
          paymentDayNumber
        );
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

      sharedParams = updateParamsOnNextDate(
        sharedParams,
        paymentDayNumber,
        moveHolidayToNextDay
      );
      continue;
    }

    if (
      sharedParams.remainingTermMonths === 1 ||
      (loanType === "ANNUITY" &&
        sharedParams.remainingPrincipal <= sharedParams.annuityMonthlyPayment)
    ) {
      schedule.push({
        monthNumber: calculateMonthNumber(
          sharedParams.nextDate,
          false,
          sharedParams.monthNumber,
          issueDate,
          paymentDayNumber
        ),
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
        monthNumber: calculateMonthNumber(
          sharedParams.nextDate,
          false,
          sharedParams.monthNumber,
          issueDate,
          paymentDayNumber
        ),
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
        monthNumber: calculateMonthNumber(
          sharedParams.nextDate,
          false,
          sharedParams.monthNumber,
          issueDate,
          paymentDayNumber
        ),
        paymentDate: sharedParams.nextDate,
        paymentAmount,
        interestAmount: interestAmount,
        principalAmount: sharedParams.amortizationPrincipal,
        remainingPrincipal: sharedParams.remainingPrincipal,
      });
    }

    // Обрабатываем досрочные платежи в тот же день после основного платежа
    if (earlyRepaymentsOnNextDate.length > 0) {
      const {
        updatedSharedParams,
        loanSchedule,
        deletedEarlyRepayments,
        updatedEarlyRepayments,
      } = applyEarlyRepayments(
        sharedParams,
        earlyRepaymentsOnNextDate,
        issueDate,
        paymentDayNumber
      );
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

    sharedParams = updateParamsOnNextDate(
      sharedParams,
      paymentDayNumber,
      moveHolidayToNextDay
    );
  }

  return {
    schedule,
    startMonthlyPayment,
  };
}

function updateParamsOnNextDate(
  sharedParams: LoanCalcSharedParams,
  paymentDayNumber: number,
  moveHolidayToNextDay: boolean
): LoanCalcSharedParams {
  sharedParams.previousDate = sharedParams.currentDate;
  sharedParams.currentDate = sharedParams.nextDate;
  sharedParams.nextDate = moveToNextDate(
    sharedParams.currentDate,
    paymentDayNumber,
    moveHolidayToNextDay
  );
  sharedParams.monthNumber += 1;
  sharedParams.remainingTermMonths -= 1;
  sharedParams.termMonthsToCalculate -=1;
  if(sharedParams.termMonthsToCalculate < 0) {
    sharedParams.termMonthsToCalculate = 0
  }
  return sharedParams;
}

function moveToNextDate(
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
  const result = roundDecimals(
    (principal *
      monthlyInterestRate *
      Math.pow(1 + monthlyInterestRate, termMonths)) /
      (Math.pow(1 + monthlyInterestRate, termMonths) - 1),
    roundingDecimals
  );
  return result;
}

function getMonthDaysAndYearDays(
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

function roundDecimals(value: number, decimals: number): number {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

/**
 * Вычисляет количество месяцев, на которое уменьшается срок кредита
 * при досрочном погашении указанной суммы основного долга.
 *
 * Формула: вычисляем разницу между сроком до и после досрочного платежа.
 * n_before = -log(1 - remainingPrincipal * r / A) / log(1 + r)
 * n_after = -log(1 - (remainingPrincipal - principalAmountPaid) * r / A) / log(1 + r)
 * monthsReduction = n_before - n_after
 */
function calculateMonthsReduction(
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

  // Вычисляем срок кредита ДО досрочного платежа
  const ratioBefore =
    (remainingPrincipal * monthlyInterestRate) / annuityMonthlyPayment;
  if (ratioBefore >= 1 || ratioBefore <= 0) {
    return 0;
  }
  const monthsBefore =
    -Math.log(1 - ratioBefore) / Math.log(1 + monthlyInterestRate);

  // Вычисляем срок кредита ПОСЛЕ досрочного платежа
  const remainingPrincipalAfter = remainingPrincipal - principalAmountPaid;
  if (remainingPrincipalAfter <= 0) {
    // Если досрочный платёж полностью погашает долг
    return Math.ceil(monthsBefore);
  }

  const ratioAfter =
    (remainingPrincipalAfter * monthlyInterestRate) / annuityMonthlyPayment;
  if (ratioAfter >= 1 || ratioAfter <= 0) {
    return 0;
  }
  const monthsAfter =
    -Math.log(1 - ratioAfter) / Math.log(1 + monthlyInterestRate);

  // Разница - это количество месяцев, на которое уменьшился срок
  const monthsReduction = monthsBefore - monthsAfter;
  console.log(
    {
      principalAmountPaid,
      remainingPrincipal,
      monthlyInterestRate,
      annuityMonthlyPayment,
    },
    Math.floor(monthsReduction)
  );
  return Math.max(0, Math.floor(monthsReduction));
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

  const nextRepayments = earlyRepayments
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
  orderedEarlyRepayments: EarlyRepaymentRecord[],
  issueDate: Date,
  paymentDayNumber: number
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
    const result = applyEarlyRepayment(
      sharedParams,
      earlyRepayment,
      issueDate,
      paymentDayNumber
    );
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
  earlyRepayment: EarlyRepaymentRecord,
  issueDate: Date,
  paymentDayNumber: number
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

  let principalAmountPaid = 0;

  if (earlyRepayment.earlyRepaymentAmount <= interestAmount) {
    updatedSharedParams.remainingInterestAmount = roundDecimals(
      interestAmount - earlyRepayment.earlyRepaymentAmount,
      sharedParams.roundingDecimals
    );

    loanSchedule.push({
      monthNumber: calculateMonthNumber(
        earlyRepayment.earlyRepaymentDate,
        true,
        sharedParams.monthNumber,
        issueDate,
        paymentDayNumber,
        sharedParams.nextDate
      ),
      paymentDate: earlyRepayment.earlyRepaymentDate,
      paymentAmount: earlyRepayment.earlyRepaymentAmount,
      interestAmount: earlyRepayment.earlyRepaymentAmount,
      principalAmount: 0,
      remainingPrincipal: sharedParams.remainingPrincipal,
      isEarlyRepayment: true,
    });
  } else {
    let paymentAmount = earlyRepayment.earlyRepaymentAmount;
    principalAmountPaid = roundDecimals(
      earlyRepayment.earlyRepaymentAmount - interestAmount,
      sharedParams.roundingDecimals
    );

    updatedSharedParams.remainingPrincipal = roundDecimals(
      updatedSharedParams.remainingPrincipal - principalAmountPaid,
      sharedParams.roundingDecimals
    );

    if (updatedSharedParams.remainingPrincipal < 0) {
      principalAmountPaid =
        principalAmountPaid + updatedSharedParams.remainingPrincipal;
      paymentAmount = paymentAmount + updatedSharedParams.remainingPrincipal;
      updatedSharedParams.remainingPrincipal = 0;
    }
    loanSchedule.push({
      monthNumber: calculateMonthNumber(
        earlyRepayment.earlyRepaymentDate,
        true,
        sharedParams.monthNumber,
        issueDate,
        paymentDayNumber,
        sharedParams.nextDate
      ),
      paymentDate: earlyRepayment.earlyRepaymentDate,
      paymentAmount,
      interestAmount,
      principalAmount: principalAmountPaid,
      remainingPrincipal: updatedSharedParams.remainingPrincipal,
      isEarlyRepayment: true,
    });
  }

  if (
    sharedParams.loanType === "ANNUITY" &&
    earlyRepayment.repaymentType === "DECREASE_PAYMENT"
  ) {
    console.log(sharedParams);
    updatedSharedParams.annuityMonthlyPayment = calculateAnnuityMonthlyPayment({
      principal: updatedSharedParams.remainingPrincipal,
      monthlyInterestRate: sharedParams.monthlyInterestRate,
      termMonths: updatedSharedParams.termMonthsToCalculate,
      roundingDecimals: sharedParams.roundingDecimals,
    });
  }

  if (
    sharedParams.loanType === "ANNUITY" &&
    earlyRepayment.repaymentType === "DECREASE_TERM" &&
    principalAmountPaid > 0
  ) {
    const monthsReduction = calculateMonthsReduction(
      principalAmountPaid,
      sharedParams.remainingPrincipal,
      sharedParams.monthlyInterestRate,
      sharedParams.annuityMonthlyPayment
    );

    if (monthsReduction > 0) {
      updatedSharedParams.remainingTermMonths = Math.max(
        0,
        updatedSharedParams.remainingTermMonths - monthsReduction
      );
      updatedSharedParams.termMonthsToCalculate = Math.max(
        0,
        updatedSharedParams.termMonthsToCalculate - monthsReduction
      );
    }
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
      updatedEarlyRepayment,
      issueDate,
      paymentDayNumber
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

/**
 * Вычисляет номер месяца от даты выдачи кредита.
 */
function calculateMonthFromIssueDate(
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
function calculateMonthNumber(
  paymentDate: Date,
  isEarlyRepayment: boolean,
  currentMonthNumber: number,
  issueDate: Date,
  paymentDayNumber: number,
  nextRegularDate?: Date
): number {
  // Обработка досрочных платежей
  if (isEarlyRepayment) {
    if (!nextRegularDate) {
      return currentMonthNumber;
    }

    // Если досрочный платеж происходит в тот же день, что и регулярный платеж
    if (isSameDay(paymentDate, nextRegularDate)) {
      return calculateMonthNumber(
        nextRegularDate,
        false,
        currentMonthNumber,
        issueDate,
        paymentDayNumber
      );
    }

    // Вычисляем номер месяца для даты досрочного платежа
    return calculateMonthFromIssueDate(paymentDate, issueDate);
  }

  // Обработка регулярных платежей
  if (paymentDate.getDate() === paymentDayNumber) {
    return calculateMonthFromIssueDate(paymentDate, issueDate);
  }

  return currentMonthNumber;
}
