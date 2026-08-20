import { addMonths, isSameDay } from "date-fns";
import {
  advanceSyncedEarlyRepaymentDate,
  alignToPaymentDate,
  buildRegularPaymentEntry,
  calculateAccruedInterest,
  calculateAmortizationMonthsReduction,
  calculateAnnuityMonthlyPayment,
  calculateAnnuityPaymentForSchedule,
  calculateMonthNumber,
  calculateMonthsReduction,
  moveToNextDate,
  recalculateAmortizationPrincipal,
  recalculateAnnuityPaymentAfterPrepayment,
  roundDecimals,
  splitEarlyRepaymentAmount,
  type DayCountBasis,
  type LoanType,
} from "./loan-schedule-helpers";

export { calculateAnnuityMonthlyPayment };

export interface EarlyRepaymentParams {
  earlyRepaymentDateStart: Date | string;
  earlyRepaymentDateEnd?: Date | string;
  periodicity?: "ONCE" | "MONTHLY" | "QUARTERLY" | "YEARLY";
  earlyRepaymentAmount?: number;
  repaymentType?: "DECREASE_TERM" | "DECREASE_PAYMENT";
  /**
   * Привязывает досрочное погашение к фактической дате регулярного
   * платежа (включая перенос с выходного на понедельник, если он
   * включён у кредита). Без этого флага дата и её повторения считаются
   * по календарю независимо от графика платежей и могут разъехаться
   * с ним, если платёж переносится из-за выходного.
   */
  syncWithPaymentDate?: boolean;
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
  loanType: LoanType;
  termMonths: number;
  issueDate: Date;
  paymentDayNumber?: number;
  interestOnlyFirstPeriod?: boolean;
  /**
   * Если true, льготный период "первый месяц - только проценты" добавляет
   * +1 месяц к общему сроку кредита сверх termMonths (старое поведение).
   * По умолчанию (false) — как у банков: льготный месяц засчитывается в
   * termMonths, а не удлиняет срок.
   */
  interestOnlyPeriodExtendsTerm?: boolean;
  moveHolidayToNextDay?: boolean;
  dayCountBasis?: DayCountBasis;
  /** Число знаков после запятой для округления денежных сумм. По умолчанию 2. */
  roundingDecimals?: number;
  /**
   * Если true (по умолчанию), аннуитетный платёж считается методом
   * goal-seek по реальному графику (реальные даты платежей, перенос
   * выходных, факт дней по dayCountBasis) - как считают реальные банки.
   * Если false - используется закрытая формула с номинальной ставкой
   * rate/12 (calculateAnnuityMonthlyPayment), как было исторически.
   */
  fullInterestModeling?: boolean;
  /**
   * Сколько ближайших платежей моделировать точно при fullInterestModeling.
   * По умолчанию (undefined) - весь оставшийся срок. Не учитывается, если
   * fullInterestModeling === false.
   */
  interestModelingHorizonMonths?: number;
  earlyRepayments?: EarlyRepaymentParams[];
}

interface LoanCalcSharedParams {
  readonly loanType: LoanType;
  readonly roundingDecimals: number;
  readonly dayCountBasis: DayCountBasis;
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
  /**
   * Накопленная поправка к ближайшему регулярному аннуитетному платежу,
   * возникающая от DECREASE_TERM-досрочек, попавших строго до даты этого
   * платежа. Банк не просто пересчитывает проценты по факту дней - он ещё
   * "отдаёт" в виде уменьшения суммы платежа проценты, которые набежали бы
   * на списанную часть долга, если бы она оставалась в теле кредита до
   * даты платежа (а не до даты самой досрочки). Сбрасывается в 0 после
   * того, как применена к очередному платежу (регулярному или льготному).
   */
  pendingInterestAdjustment: number;
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
    interestOnlyPeriodExtendsTerm = false,
    dayCountBasis = "ACTUAL_365",
    roundingDecimals = 2,
    earlyRepayments = [],
    moveHolidayToNextDay = false,
    fullInterestModeling = true,
    interestModelingHorizonMonths,
  } = params;
  issueDate.setHours(0, 0, 0, 0);

  if (principal <= 0) throw new Error("principal must be > 0");
  if (termMonths <= 0) throw new Error("termMonths must be > 0");
  if (annualInterestRatePercent < 0)
    throw new Error("annualInterestRatePercent must be >= 0");

  const paymentDayNumber = params.paymentDayNumber ?? issueDate.getDate();
  const interestModelingOptions: InterestModelingOptions = {
    fullInterestModeling,
    interestModelingHorizonMonths,
  };

  const earlyRepaymentRecords: Record<number, EarlyRepaymentRecord> = {};
  earlyRepayments.forEach((earlyRepayment, index) => {
    const earlyRepaymentDateStart = new Date(
      earlyRepayment.earlyRepaymentDateStart
    );
    earlyRepaymentRecords[index] = {
      ...earlyRepayment,
      id: index,
      earlyRepaymentDateStart,
      earlyRepaymentDateEnd: earlyRepayment.earlyRepaymentDateEnd
        ? new Date(earlyRepayment.earlyRepaymentDateEnd)
        : undefined,
      earlyRepaymentDate: earlyRepayment.syncWithPaymentDate
        ? alignToPaymentDate(
            earlyRepaymentDateStart,
            paymentDayNumber,
            moveHolidayToNextDay
          )
        : earlyRepaymentDateStart,
    };
  });
  // Льготный "только проценты" месяц по умолчанию засчитывается в
  // termMonths (как у банков), а не удлиняет срок сверх него.
  const initialRemainingTermMonths =
    interestOnlyFirstPeriod && !interestOnlyPeriodExtendsTerm
      ? termMonths - 1
      : termMonths;
  // Делитель формулы аннуитета/амортизации считает только РЕГУЛЯРНЫЕ
  // периоды - т.е. общий бюджет итераций минус сам льготный месяц (который
  // тоже расходует одну итерацию цикла, но не является "регулярным"
  // периодом погашения). Если считать его от termMonths напрямую, а не от
  // initialRemainingTermMonths, при interestOnlyPeriodExtendsTerm=false
  // делитель и реально доступное число итераций расходятся на 1 месяц, и
  // остаток долга "прыжком" списывается одним платежом в конце графика.
  const termMonthsToCalculate = interestOnlyFirstPeriod
    ? initialRemainingTermMonths - 1
    : initialRemainingTermMonths;
  // Аннуитетный платёж: по умолчанию считаем методом goal-seek по реальному
  // графику (реальные даты, перенос выходных, факт дней) - так, как
  // фактически считают реальные банки (см. calculateAnnuityPaymentForSchedule).
  // fullInterestModeling: false возвращает старую закрытую формулу
  // (номинальная ставка rate/12 на все периоды).
  const annuityPaymentStartDate = interestOnlyFirstPeriod
    ? moveToNextDate(issueDate, paymentDayNumber, moveHolidayToNextDay)
    : issueDate;
  const annuityMonthlyPaymentValue = fullInterestModeling
    ? calculateAnnuityPaymentForSchedule({
        principal,
        annualInterestRatePercent,
        dayCountBasis,
        startDate: annuityPaymentStartDate,
        paymentDayNumber,
        moveHolidayToNextDay,
        termMonths: termMonthsToCalculate,
        roundingDecimals,
        horizonMonths: interestModelingHorizonMonths,
      })
    : calculateAnnuityMonthlyPayment({
        principal,
        monthlyInterestRate: annualInterestRatePercent / 12 / 100,
        termMonths: termMonthsToCalculate,
        roundingDecimals,
      });
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
    annuityMonthlyPayment: annuityMonthlyPaymentValue,
    remainingInterestAmount: 0,
    pendingInterestAdjustment: 0,
    roundingDecimals,
    dayCountBasis,
    monthNumber: 1,
    remainingTermMonths: initialRemainingTermMonths,
  };

  const startMonthlyPayment =
    loanType === "ANNUITY"
      ? sharedParams.annuityMonthlyPayment
      : sharedParams.amortizationPrincipal;

  // При fullInterestModeling (по умолчанию) аннуитетный платёж считается
  // goal-seek'ом по реальному графику, поэтому остаток должен обнуляться
  // практически точно к termMonths-му периоду - расхождение остаётся
  // только на уровне копеек (округление). При fullInterestModeling: false
  // (старая закрытая формула rate/12) расхождение может накапливаться
  // сильнее на длинных сроках. В обоих случаях даём графику органически
  // "дожить" до нуля вместо форсированного платежа ровно на termMonths-м
  // месяце. maxOverrunMonths - защитный потолок на случай аномальных
  // входных данных (не должен достигаться в реальных сценариях).
  const maxOverrunMonths = 3;
  const maxMonthNumber = initialRemainingTermMonths + maxOverrunMonths;

  while (
    sharedParams.remainingTermMonths > 0 ||
    (loanType === "ANNUITY" &&
      sharedParams.remainingPrincipal > 0 &&
      sharedParams.monthNumber <= maxMonthNumber)
  ) {
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

    // Сначала обрабатываем досрочные платежи, которые до nextDate.
    // Ни один регулярный платёж в этом периоде ещё не списан, поэтому
    // termMonthsToCalculate уже корректно отражает число оставшихся периодов.
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
        paymentDayNumber,
        moveHolidayToNextDay,
        sharedParams.termMonthsToCalculate,
        interestModelingOptions
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

    const interestAmount =
      sharedParams.remainingInterestAmount != 0
        ? sharedParams.remainingInterestAmount
        : calculateAccruedInterest({
            principal: sharedParams.remainingPrincipal,
            annualInterestRatePercent,
            dayCountBasis,
            fromDate: sharedParams.currentDate,
            toDate: sharedParams.nextDate,
            roundingDecimals,
          });

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

      // Обрабатываем досрочные платежи в тот же день после основного платежа.
      // Интерес-онли платёж не расходует period из termMonthsToCalculate
      // (он изначально не учтён в этом счётчике), поэтому счётчик всё ещё корректен.
      const earlyRepaymentsOnNextDateAfterInterestOnly = getNextEarlyRepayment(
        earlyRepaymentRecords,
        sharedParams.currentDate,
        sharedParams.nextDate
      ).filter((er) => isSameDay(er.earlyRepaymentDate, sharedParams.nextDate));

      if (earlyRepaymentsOnNextDateAfterInterestOnly.length > 0) {
        const {
          updatedSharedParams,
          loanSchedule,
          deletedEarlyRepayments,
          updatedEarlyRepayments,
        } = applyEarlyRepayments(
          // currentDate искусственно "продвинут" до nextDate: проценты по
          // периоду уже полностью оплачены "только проценты"-платежом выше,
          // поэтому досрочный платёж, попавший на ту же дату, не должен
          // ещё раз накапливать проценты за весь прошедший период.
          { ...sharedParams, currentDate: sharedParams.nextDate },
          earlyRepaymentsOnNextDateAfterInterestOnly,
          issueDate,
          paymentDayNumber,
          moveHolidayToNextDay,
          sharedParams.termMonthsToCalculate,
          interestModelingOptions
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

      // Льготный платёж - не аннуитетный, поправка к нему неприменима; и
      // она не должна "утечь" на следующий (уже настоящий регулярный) платёж.
      sharedParams.pendingInterestAdjustment = 0;

      sharedParams = updateParamsOnNextDate(
        sharedParams,
        paymentDayNumber,
        moveHolidayToNextDay
      );
      continue;
    }

    // Для AMORTIZATION тело долга каждый период уменьшается на строго
    // фиксированную сумму, поэтому remainingTermMonths===1 гарантированно
    // означает "это последний период" - расхождения ставки/дней тут не
    // накапливаются. Для ANNUITY платёж фиксирован, а не тело долга, поэтому
    // ориентируемся только на фактический остаток - это то, что позволяет
    // графику органически "дожить" до нуля (см. комментарий у while выше),
    // а не оборвать его ровно на termMonths-м месяце.
    const isFinalPayment =
      loanType === "ANNUITY"
        ? sharedParams.remainingPrincipal <= sharedParams.annuityMonthlyPayment
        : sharedParams.remainingTermMonths === 1;
    if (isFinalPayment) {
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

    const regularPayment = buildRegularPaymentEntry({
      loanType,
      interestAmount,
      remainingPrincipal: sharedParams.remainingPrincipal,
      annuityMonthlyPayment: roundDecimals(
        sharedParams.annuityMonthlyPayment - sharedParams.pendingInterestAdjustment,
        roundingDecimals
      ),
      amortizationPrincipal: sharedParams.amortizationPrincipal,
      roundingDecimals,
    });
    sharedParams.remainingPrincipal = regularPayment.remainingPrincipalAfter;
    sharedParams.pendingInterestAdjustment = 0;
    schedule.push({
      monthNumber: calculateMonthNumber(
        sharedParams.nextDate,
        false,
        sharedParams.monthNumber,
        issueDate,
        paymentDayNumber
      ),
      paymentDate: sharedParams.nextDate,
      paymentAmount: regularPayment.paymentAmount,
      interestAmount,
      principalAmount: regularPayment.principalAmount,
      remainingPrincipal: sharedParams.remainingPrincipal,
    });

    // Обрабатываем досрочные платежи в тот же день после основного платежа.
    // Регулярный платёж за этот период уже списан, поэтому:
    // 1) из счётчика оставшихся периодов исключаем только что оплаченный период;
    // 2) currentDate искусственно "продвинут" до nextDate, чтобы проценты по
    //    досрочному платежу не начислялись повторно за уже оплаченный период
    //    (иначе он посчитал бы те же 30 дней процентов ещё раз).
    if (earlyRepaymentsOnNextDate.length > 0) {
      const {
        updatedSharedParams,
        loanSchedule,
        deletedEarlyRepayments,
        updatedEarlyRepayments,
      } = applyEarlyRepayments(
        { ...sharedParams, currentDate: sharedParams.nextDate },
        earlyRepaymentsOnNextDate,
        issueDate,
        paymentDayNumber,
        moveHolidayToNextDay,
        Math.max(0, sharedParams.termMonthsToCalculate - 1),
        interestModelingOptions
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
  sharedParams.termMonthsToCalculate -= 1;
  if (sharedParams.termMonthsToCalculate < 0) {
    sharedParams.termMonthsToCalculate = 0;
  }
  return sharedParams;
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

interface InterestModelingOptions {
  fullInterestModeling: boolean;
  interestModelingHorizonMonths?: number;
}

function applyEarlyRepayments(
  sharedParams: LoanCalcSharedParams,
  orderedEarlyRepayments: EarlyRepaymentRecord[],
  issueDate: Date,
  paymentDayNumber: number,
  moveHolidayToNextDay: boolean,
  periodsRemainingForRecompute: number,
  interestModelingOptions: InterestModelingOptions
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
      updatedSharedParams,
      earlyRepayment,
      issueDate,
      paymentDayNumber,
      moveHolidayToNextDay,
      periodsRemainingForRecompute,
      interestModelingOptions
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
  paymentDayNumber: number,
  moveHolidayToNextDay: boolean,
  periodsRemainingForRecompute: number,
  interestModelingOptions: InterestModelingOptions
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
  let updatedEarlyRepayment: EarlyRepaymentRecord | undefined = {
    ...earlyRepayment,
  };

  const accruedInterest = calculateAccruedInterest({
    principal: sharedParams.remainingPrincipal,
    annualInterestRatePercent: sharedParams.annualInterestRatePercent,
    dayCountBasis: sharedParams.dayCountBasis,
    fromDate: sharedParams.currentDate,
    toDate: earlyRepayment.earlyRepaymentDate,
    roundingDecimals: sharedParams.roundingDecimals,
  });

  const split = splitEarlyRepaymentAmount({
    earlyRepaymentAmount: earlyRepayment.earlyRepaymentAmount ?? 0,
    accruedInterest,
    remainingPrincipal: sharedParams.remainingPrincipal,
    roundingDecimals: sharedParams.roundingDecimals,
  });

  updatedSharedParams.remainingInterestAmount = split.remainingInterestCarryover;
  updatedSharedParams.remainingPrincipal = split.remainingPrincipalAfter;

  const principalAmountPaid = split.principalPaid;

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
    paymentAmount: split.actualPaymentAmount,
    interestAmount: split.interestPaid,
    principalAmount: principalAmountPaid,
    remainingPrincipal: updatedSharedParams.remainingPrincipal,
    isEarlyRepayment: true,
  });

  if (sharedParams.loanType === "ANNUITY") {
    // Точный (goal-seek) расчёт должен начинаться с даты самого досрочного
    // платежа: ниже (после этого блока) currentDate безусловно
    // перезаписывается на earlyRepayment.earlyRepaymentDate, и именно от
    // неё отсчитывается начисление процентов для ВСЕХ последующих периодов
    // (включая ещё не списанный текущий регулярный платёж, если досрочный
    // платёж пришёлся строго до nextDate - его окно становится
    // [earlyRepaymentDate, nextDate), а не полным месяцем). Используется и
    // для пересчёта платежа (DECREASE_PAYMENT), и для симуляции сокращения
    // срока (DECREASE_TERM).
    const goalSeekStartDate = earlyRepayment.earlyRepaymentDate;

    if (earlyRepayment.repaymentType === "DECREASE_PAYMENT") {
      if (interestModelingOptions.fullInterestModeling) {
        updatedSharedParams.annuityMonthlyPayment =
          calculateAnnuityPaymentForSchedule({
            principal: updatedSharedParams.remainingPrincipal,
            annualInterestRatePercent: sharedParams.annualInterestRatePercent,
            dayCountBasis: sharedParams.dayCountBasis,
            startDate: goalSeekStartDate,
            paymentDayNumber,
            moveHolidayToNextDay,
            termMonths: periodsRemainingForRecompute,
            roundingDecimals: sharedParams.roundingDecimals,
            horizonMonths: interestModelingOptions.interestModelingHorizonMonths,
          });
      } else {
        updatedSharedParams.annuityMonthlyPayment =
          recalculateAnnuityPaymentAfterPrepayment({
            remainingPrincipal: updatedSharedParams.remainingPrincipal,
            monthlyInterestRate: sharedParams.monthlyInterestRate,
            periodsRemaining: periodsRemainingForRecompute,
            roundingDecimals: sharedParams.roundingDecimals,
          });
      }
    } else if (
      earlyRepayment.repaymentType === "DECREASE_TERM" &&
      principalAmountPaid > 0
    ) {
      // Банк не пересчитывает сумму фиксированного платежа при DECREASE_TERM
      // (иначе это было бы DECREASE_PAYMENT) - но если досрочка пришлась
      // строго до даты ближайшего регулярного платежа, тот платёж всё равно
      // не останется равным annuityMonthlyPayment: банк "возвращает" в виде
      // уменьшения суммы платежа проценты, которые набежали бы на списанную
      // часть долга (principalAmountPaid), останься она в теле кредита до
      // даты платежа, а не до даты самой досрочки. Без этой поправки
      // ближайший регулярный платёж после такой досрочки завышен ровно на
      // accruedInterest + delayedInterest.
      const delayedInterest = calculateAccruedInterest({
        principal: principalAmountPaid,
        annualInterestRatePercent: sharedParams.annualInterestRatePercent,
        dayCountBasis: sharedParams.dayCountBasis,
        fromDate: earlyRepayment.earlyRepaymentDate,
        toDate: sharedParams.nextDate,
        roundingDecimals: sharedParams.roundingDecimals,
      });
      updatedSharedParams.pendingInterestAdjustment =
        sharedParams.pendingInterestAdjustment + accruedInterest + delayedInterest;

      // Пересчёт срока для DECREASE_TERM пока намеренно оставлен на старой
      // закрытой формуле даже при fullInterestModeling: true. Для ANNUITY
      // завершение графика управляется остатком долга (isFinalPayment), а
      // не этим счётчиком, так что его точность не критична для сумм
      // платежей - а goal-seek-совместимая симуляция (через
      // calculateMonthsReductionForSchedule) оказалась сложнее корректно
      // отладить, чем стоит в рамках этого фикса. Вернуться к этому отдельно.
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
  }

  if (sharedParams.loanType === "AMORTIZATION") {
    if (
      earlyRepayment.repaymentType === "DECREASE_TERM" &&
      principalAmountPaid > 0
    ) {
      const monthsReduction = calculateAmortizationMonthsReduction({
        principalAmountPaid,
        remainingPrincipal: sharedParams.remainingPrincipal,
        amortizationPrincipal: sharedParams.amortizationPrincipal,
      });

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
    } else {
      updatedSharedParams.amortizationPrincipal = recalculateAmortizationPrincipal({
        remainingPrincipal: updatedSharedParams.remainingPrincipal,
        periodsRemaining: periodsRemainingForRecompute,
        roundingDecimals: sharedParams.roundingDecimals,
      });
    }
  }

  updatedSharedParams.previousDate = updatedSharedParams.currentDate;
  updatedSharedParams.currentDate = earlyRepayment.earlyRepaymentDate;

  const advanceRecurringDate = (monthsPerOccurrence: number): Date =>
    earlyRepayment.syncWithPaymentDate
      ? advanceSyncedEarlyRepaymentDate(
          earlyRepayment.earlyRepaymentDate,
          monthsPerOccurrence,
          paymentDayNumber,
          moveHolidayToNextDay
        )
      : addMonths(earlyRepayment.earlyRepaymentDate, monthsPerOccurrence);

  switch (earlyRepayment.periodicity) {
    case "ONCE":
      deleteEarlyRepayment = true;
      updatedEarlyRepayment = undefined;
      break;
    case "MONTHLY":
      updatedEarlyRepayment = {
        ...updatedEarlyRepayment,
        earlyRepaymentDate: advanceRecurringDate(1),
      };
      break;
    case "QUARTERLY":
      updatedEarlyRepayment = {
        ...updatedEarlyRepayment,
        earlyRepaymentDate: advanceRecurringDate(3),
      };
      break;
    case "YEARLY":
      updatedEarlyRepayment = {
        ...updatedEarlyRepayment,
        earlyRepaymentDate: advanceRecurringDate(12),
      };
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
      paymentDayNumber,
      moveHolidayToNextDay,
      periodsRemainingForRecompute,
      interestModelingOptions
    );
    loanSchedule.push(...nextRepayment.loanSchedule);
    updatedSharedParams = nextRepayment.updatedSharedParams;
    deleteEarlyRepayment = nextRepayment.deleteEarlyRepayment;
    updatedEarlyRepayment = nextRepayment.updatedEarlyRepayment;
  }

  if (
    updatedEarlyRepayment &&
    updatedEarlyRepayment.earlyRepaymentDateEnd &&
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
