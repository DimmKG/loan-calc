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
import { useEffect, useState } from "react";
import { differenceInMonths, format } from "date-fns";
import { LoanScheduleEntry, LoanScheduleResult } from "../../lib/loan-lib";
import { Badge } from "../../components/ui/badge";

interface LoanSummary {
  totalPayments: number;
  totalPrincipal: number;
  totalInterest: number;
  loanTerm: string;
  monthlyPayment: number;
}

export default function LoanSummaryCards({
  data,
  roundingDecimals,
}: {
  data: LoanScheduleResult
  roundingDecimals: number;
}) {
  const [isChartOpen, setIsChartOpen] = useState(false);
  const [groupedData, setGroupedData] = useState<LoanScheduleEntry[]>([]);
  const [summary, setSummary] = useState<LoanSummary | undefined>(undefined);

  useEffect(() => {
    const { schedule, startMonthlyPayment } = data
    let groupByMonth = Object.groupBy(schedule, (item) =>
        format(item.paymentDate, "yyyy-MM")
      );
      const groupedData = Object.entries(groupByMonth).map(
        ([key, value]): LoanScheduleEntry => ({
          monthNumber: value[0].monthNumber,
          paymentDate: new Date(key),
          paymentAmount: value.reduce(
            (sum, item) => sum + item.paymentAmount,
            0
          ),
          principalAmount: value.reduce(
            (sum, item) => sum + item.principalAmount,
            0
          ),
          interestAmount: value.reduce(
            (sum, item) => sum + item.interestAmount,
            0
          ),
          remainingPrincipal: value.reduce(
            (sum, item) => sum + item.remainingPrincipal,
            0
          ),
        })
      );
      setGroupedData(groupedData);
      // Вычисляем сводку по кредиту
      const totalPayments = schedule.reduce(
        (sum, item) => sum + item.paymentAmount,
        0
      );
      const totalPrincipal = schedule.reduce(
        (sum, item) => sum + item.principalAmount,
        0
      );
      const totalInterest = schedule.reduce(
        (sum, item) => sum + item.interestAmount,
        0
      );

      const months =
        differenceInMonths(
            schedule[schedule.length - 1].paymentDate,
            schedule[0].paymentDate
        ) + 1;
      const years = Math.floor(months / 12);
      const remainingMonths = months % 12;

      let loanTerm = "";
      if (years > 0) {
        loanTerm += `${years} ${
          years === 1 ? "год" : years < 5 ? "года" : "лет"
        }`;
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

      const monthlyPayment = startMonthlyPayment;

      setSummary({
        totalPayments,
        totalPrincipal,
        totalInterest,
        loanTerm,
        monthlyPayment,
      });
  }, [data])

  if(!summary) return null

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
          </div>

          <div className="text-center mb-4">
            <Badge variant="secondary" className="text-base px-3 py-1">
              Срок кредита: {summary.loanTerm}
            </Badge>
          </div>

          {/* Кнопка графика платежей */}
          <PaymentsChartDialog
            groupedData={groupedData.map((value) => ({
              paymentDate: format(value.paymentDate, "yyyy-MM"),
              principalAmount: Number(
                value.paymentAmount.toFixed(roundingDecimals)
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
