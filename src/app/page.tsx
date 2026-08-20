"use client";

import { LoanScheduleResult, generateLoanSchedule } from "@/lib/loan-lib";
import { useCallback, useState } from "react";
import { LoanInputForm } from "../types/loan-input-form.type";
import { format } from "date-fns";
import { generateLoanScheduleCSV } from "@/lib/utils";
import dynamic from "next/dynamic";
import { Card, CardContent } from "@/components/ui/card";
import PaymentsTableCard from "./ui/payments-table-card";
import LoanSummaryCards from "./ui/loan-summary-cards";

const LoanInputCard = dynamic(() => import("./ui/loan-input-card"), {
  ssr: false,
});

export default function Page() {
  const [result, setResult] = useState<LoanScheduleResult | undefined>();
  const [loanMeta, setLoanMeta] = useState<
    { principal: number; issueDate: Date } | undefined
  >();
  const [roundingDecimals, setRoundingDecimals] = useState(2);
  const [isLoading, setIsLoading] = useState(false);

  const onFormSubmit = useCallback(
    (form: LoanInputForm) => {
      setIsLoading(true);
      setResult(undefined);

      // Имитируем небольшую задержку для визуального эффекта
      setTimeout(() => {
        const result = generateLoanSchedule({
          ...form,
          termMonths: form.loanTerm * (form.loanTermType === "y" ? 12 : 1),
          principal: form.loanAmount,
          annualInterestRatePercent: form.interestRate,
          earlyRepayments: form.earlyRepayments,
        });

        setResult(result);
        setLoanMeta({ principal: form.loanAmount, issueDate: form.issueDate });
        setRoundingDecimals(form.roundingDecimals || 2);
        setIsLoading(false);
      }, 200);
    },
    [result]
  );

  const handleExportCSV = useCallback(() => {
    if (result.schedule.length === 0) return;

    const csvContent = generateLoanScheduleCSV(
      result.schedule,
      roundingDecimals
    );
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `loan-schedule-${format(new Date(), "yyyy-MM-dd")}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [result, roundingDecimals]);

  return (
    <div className="min-h-screen bg-background from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Заголовок */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2">
            Кредитный калькулятор
          </h1>
          <p className="text-slate-600 dark:text-slate-400 text-lg">
            Рассчитайте график платежей и проанализируйте условия кредита
          </p>
        </div>

        {/* Форма калькулятора - расширенная по горизонтали */}
        <div className="mb-8">
          <LoanInputCard onFormSubmit={onFormSubmit} />
        </div>

        {/* Результаты - под формой */}
        {isLoading && (
          <Card className="mb-6">
            <CardContent className="flex items-center justify-center h-32">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
                <div className="text-muted-foreground">
                  Выполняется расчёт...
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {result?.schedule.length && loanMeta && (
          <div className="space-y-6">
            {/* Сводка по кредиту и круговая диаграмма */}
            <LoanSummaryCards
              data={result}
              principal={loanMeta.principal}
              issueDate={loanMeta.issueDate}
              roundingDecimals={roundingDecimals}
            />

            {/* Таблица платежей */}
            <PaymentsTableCard
              data={result.schedule.map((item) => ({
                month: item.monthNumber,
                paymentDate: format(item.paymentDate, "dd.MM.yyyy"),
                paymentAmount: item.paymentAmount.toFixed(roundingDecimals),
                principalAmount: item.principalAmount.toFixed(roundingDecimals),
                interestAmount: item.interestAmount.toFixed(roundingDecimals),
                remainingPrincipal:
                  item.remainingPrincipal.toFixed(roundingDecimals),
                isEarlyRepayment: item.isEarlyRepayment,
              }))}
              onExportClick={handleExportCSV}
            />
          </div>
        )}

        {/* Футер */}
        <footer className="mt-16 pt-8 border-t border-slate-200 dark:border-slate-700">
          <div className="text-center text-sm text-slate-600 dark:text-slate-400">
            <p className="mb-2">© 2026 DimmKG. Лицензия AGPL-3.0</p>
            <p>
              <a
                href="https://github.com/DimmKG/loan-calc"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline transition-colors"
              >
                Исходный код на GitHub
              </a>
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
