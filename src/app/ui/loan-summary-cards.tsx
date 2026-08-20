import { CalculatorIcon } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import LoanPieChartCard from "./loan-pie-chart-card";
import PaymentsChartDialog from "./payments-chart-dialog";
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { LoanScheduleResult } from "../../lib/loan-lib";
import { calculateLoanSummary, groupScheduleByMonth } from "../../lib/loan-statistics";
import { Badge } from "../../components/ui/badge";

function formatLoanTermRu(months: number): string {
  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;

  let loanTerm = "";
  if (years > 0) {
    loanTerm += `${years} ${years === 1 ? "год" : years < 5 ? "года" : "лет"}`;
  }
  if (remainingMonths > 0) {
    if (loanTerm) loanTerm += " ";
    loanTerm += `${remainingMonths} ${
      remainingMonths === 1
        ? "месяц"
        : remainingMonths < 5
        ? "месяца"
        : "месяцев"
    }`;
  }
  return loanTerm;
}

export default function LoanSummaryCards({
  data,
  principal,
  issueDate,
  roundingDecimals,
}: {
  data: LoanScheduleResult;
  principal: number;
  issueDate: Date;
  roundingDecimals: number;
}) {
  const [isChartOpen, setIsChartOpen] = useState(false);

  const summary = useMemo(
    () => calculateLoanSummary({ result: data, principal, issueDate }),
    [data, principal, issueDate]
  );
  const groupedData = useMemo(
    () => groupScheduleByMonth(data.schedule),
    [data]
  );

  if (!summary) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <LoanPieChartCard
        totalInterest={summary.totalInterest}
        totalPrincipal={summary.totalPrincipal}
      />
      {/* Сводка по кредиту с кнопкой графика */}
      <Card className="order-1 lg:order-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalculatorIcon className="h-5 w-5" />
            Сводка по кредиту
          </CardTitle>
          <CardDescription>Основные показатели кредита</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div className="text-center p-3 bg-blue-50 dark:bg-blue-950 rounded-lg">
              <div className="text-lg font-bold text-blue-600 dark:text-blue-400 break-words">
                {summary.totalPayments.toLocaleString("ru-RU", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </div>
              <div className="text-xs text-blue-600 dark:text-blue-400">
                Общая сумма
              </div>
            </div>
            <div className="text-center p-3 bg-green-50 dark:bg-green-950 rounded-lg">
              <div className="text-lg font-bold text-green-600 dark:text-green-400 break-words">
                {summary.totalPrincipal.toLocaleString("ru-RU", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </div>
              <div className="text-xs text-green-600 dark:text-green-400">
                Основной долг
              </div>
            </div>
            <div className="text-center p-3 bg-orange-50 dark:bg-orange-950 rounded-lg">
              <div className="text-lg font-bold text-orange-600 dark:text-orange-400 break-words">
                {summary.totalInterest.toLocaleString("ru-RU", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </div>
              <div className="text-xs text-orange-600 dark:text-orange-400">
                Проценты
              </div>
            </div>
            <div className="text-center p-3 bg-purple-50 dark:bg-purple-950 rounded-lg">
              <div className="text-lg font-bold text-purple-600 dark:text-purple-400 break-words">
                {summary.monthlyPayment.toLocaleString("ru-RU", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </div>
              <div className="text-xs text-purple-600 dark:text-purple-400">
                Ежемесячный платёж
              </div>
            </div>
            <div className="text-center p-3 bg-rose-50 dark:bg-rose-950 rounded-lg">
              <div className="text-lg font-bold text-rose-600 dark:text-rose-400 break-words">
                {summary.overpaymentPercent.toLocaleString("ru-RU", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
                %
              </div>
              <div className="text-xs text-rose-600 dark:text-rose-400">
                Переплата
              </div>
            </div>
            <div className="text-center p-3 bg-teal-50 dark:bg-teal-950 rounded-lg">
              <div className="text-lg font-bold text-teal-600 dark:text-teal-400 break-words">
                {summary.fullCostOfCreditPercent === null
                  ? "—"
                  : summary.fullCostOfCreditPercent.toLocaleString("ru-RU", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 3,
                    })}
                {summary.fullCostOfCreditPercent !== null && "%"}
              </div>
              <div className="text-xs text-teal-600 dark:text-teal-400">
                Полная стоимость кредита
              </div>
            </div>
          </div>

          <div className="text-center mb-4">
            <Badge variant="secondary" className="text-base px-3 py-1">
              Срок кредита: {formatLoanTermRu(summary.termMonths)}
            </Badge>
          </div>

          {/* Кнопка графика платежей */}
          <PaymentsChartDialog
            groupedData={groupedData.map((value) => ({
              paymentDate: format(value.paymentDate, "yyyy-MM"),
              principalAmount: Number(
                value.principalAmount.toFixed(roundingDecimals)
              ),
              interestAmount: Number(
                value.interestAmount.toFixed(roundingDecimals)
              ),
            }))}
            isChartOpen={isChartOpen}
            setIsChartOpen={setIsChartOpen}
          />
        </CardContent>
      </Card>
    </div>
  );
}
