"use client";

import { DataTable } from "@/components/ui/data-table";
import { LoanScheduleEntry, generateLoanSchedule } from "@/lib/loan-lib";
import { CSSProperties, useState } from "react";
import { LoanInputForm } from "../types/loan-input-form.type";
import { ColumnDef, Row } from "@tanstack/react-table";
import { differenceInMonths, format } from "date-fns";
import dynamic from "next/dynamic";
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Area, AreaChart, XAxis, CartesianGrid, PieChart, Pie, Cell } from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BarChart3Icon, CalculatorIcon, CalendarCheck2Icon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const LoanInputCard = dynamic(() => import("./loan-input-card"), {
  ssr: false,
});

interface LoanScheduleRow {
  month: number;
  paymentDate: string;
  paymentAmount: string;
  principalAmount: string;
  interestAmount: string;
  remainingPrincipal: string;
  isEarlyRepayment: boolean;
}

interface LoanSummary {
  totalPayments: number;
  totalPrincipal: number;
  totalInterest: number;
  loanTerm: string;
  monthlyPayment: number;
}

const columns: ColumnDef<LoanScheduleRow>[] = [
  {
    header: "№",
    accessorKey: "month",
  },
  {
    header: "Дата",
    accessorKey: "paymentDate",
  },
  {
    header: "Платеж",
    accessorKey: "paymentAmount",
  },
  {
    header: "Основной долг",
    accessorKey: "principalAmount",
  },
  {
    header: "Проценты",
    accessorKey: "interestAmount",
  },
  {
    header: "Остаток",
    accessorKey: "remainingPrincipal",
  },
];

const chartConfig = {
  paymentAmount: {
    label: "Общий платёж",
    color: "#10b981",
  },
  interestAmount: {
    label: "Проценты",
    color: "#60a5fa",
  },
} satisfies ChartConfig;

const COLORS = ["#10b981", "#60a5fa"];

export default function Page() {
  const [data, setData] = useState<LoanScheduleEntry[]>([]);
  const [groupedData, setGroupedData] = useState<LoanScheduleEntry[]>([]);
  const [summary, setSummary] = useState<LoanSummary | null>(null);
  const [roundingDecimals, setRoundingDecimals] = useState(2);
  const [isLoading, setIsLoading] = useState(false);
  const [isChartOpen, setIsChartOpen] = useState(false);

  function onFormSubmit(form: LoanInputForm) {
    setIsLoading(true);
    setData([]);
    setSummary(null);
    
    // Имитируем небольшую задержку для визуального эффекта
    setTimeout(() => {
      const { schedule, startMonthlyPayment } = generateLoanSchedule({
        ...form,
        termMonths: form.loanTerm * (form.loanTermType === "y" ? 12 : 1),
        principal: form.loanAmount,
        annualInterestRatePercent: form.interestRate,
        earlyRepayments: form.earlyRepayments
      });
      
      setData(schedule);
      let groupByMonth = Object.groupBy(schedule, (item) => format(item.paymentDate, "yyyy-MM"));
      const groupedData = Object.entries(groupByMonth).map(([key, value]): LoanScheduleEntry => ({
        paymentDate: new Date(key),
        paymentAmount: value.reduce((sum, item) => sum + item.paymentAmount, 0),
        principalAmount: value.reduce((sum, item) => sum + item.principalAmount, 0),
        interestAmount: value.reduce((sum, item) => sum + item.interestAmount, 0),
        remainingPrincipal: value.reduce((sum, item) => sum + item.remainingPrincipal, 0),
      }));
      setGroupedData(groupedData);
      setRoundingDecimals(form.roundingDecimals || 2);
      
      // Вычисляем сводку по кредиту
      const totalPayments = schedule.reduce((sum, item) => sum + item.paymentAmount, 0);
      const totalPrincipal = schedule.reduce((sum, item) => sum + item.principalAmount, 0);
      const totalInterest = schedule.reduce((sum, item) => sum + item.interestAmount, 0);
      
      const months = differenceInMonths(schedule[schedule.length - 1].paymentDate, schedule[0].paymentDate)+1;
      const years = Math.floor(months / 12);
      const remainingMonths = months % 12;
      
      let loanTerm = "";
      if (years > 0) {
        loanTerm += `${years} ${years === 1 ? 'год' : years < 5 ? 'года' : 'лет'}`;
      }
      if (remainingMonths > 0) {
        if (loanTerm) loanTerm += " ";
        loanTerm += `${remainingMonths} ${remainingMonths === 1 ? 'месяц' : remainingMonths < 5 ? 'месяца' : 'месяцев'}`;
      }
      
      const monthlyPayment = startMonthlyPayment;
      
      setSummary({
        totalPayments,
        totalPrincipal,
        totalInterest,
        loanTerm,
        monthlyPayment
      });
      
      setIsLoading(false);
    }, 200);
  }

  const pieChartData = summary ? [
    { name: "Основной долг", value: summary.totalPrincipal },
    { name: "Проценты", value: summary.totalInterest }
  ] : [];

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
                <div className="text-muted-foreground">Выполняется расчёт...</div>
              </div>
            </CardContent>
          </Card>
        )}

        {summary && (
          <div className="space-y-6">
            {/* Графики и таблица в сетке */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Круговая диаграмма */}
              <Card className="order-2 lg:order-1">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3Icon className="h-5 w-5" />
                    Структура платежей
                  </CardTitle>
                  <CardDescription>
                    Распределение общей суммы по основному долгу и процентам
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex justify-center">
                    <PieChart width={250} height={250}>
                      <Pie
                        data={pieChartData}
                        cx={125}
                        cy={125}
                        labelLine={false}
                        outerRadius={100}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {pieChartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                    </PieChart>
                  </div>
                  
                  {/* Легенда с процентами */}
                  <div className="mt-6 space-y-3">
                    {pieChartData.map((entry, index) => {
                      const percentage = ((entry.value / (summary.totalPrincipal + summary.totalInterest)) * 100).toFixed(1);
                      return (
                        <div key={entry.name} className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div 
                              className="w-4 h-4 rounded" 
                              style={{ backgroundColor: COLORS[index % COLORS.length] }}
                            ></div>
                            <span className="text-sm font-medium">{entry.name}</span>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-bold">
                              {entry.value.toLocaleString('ru-RU', { 
                                minimumFractionDigits: 2, 
                                maximumFractionDigits: 2 
                              })}
                            </div>
                            <div className="text-xs text-muted-foreground">{percentage}%</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              {/* Сводка по кредиту с кнопкой графика */}
              <Card className="order-1 lg:order-2">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CalculatorIcon className="h-5 w-5" />
                    Сводка по кредиту
                  </CardTitle>
                  <CardDescription>
                    Основные показатели кредита
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                    <div className="text-center p-3 bg-blue-50 dark:bg-blue-950 rounded-lg">
                      <div className="text-lg font-bold text-blue-600 dark:text-blue-400 break-words">
                        {summary.totalPayments.toLocaleString('ru-RU', { 
                          minimumFractionDigits: 2, 
                          maximumFractionDigits: 2 
                        })}
                      </div>
                      <div className="text-xs text-blue-600 dark:text-blue-400">Общая сумма</div>
                    </div>
                    <div className="text-center p-3 bg-green-50 dark:bg-green-950 rounded-lg">
                      <div className="text-lg font-bold text-green-600 dark:text-green-400 break-words">
                        {summary.totalPrincipal.toLocaleString('ru-RU', { 
                          minimumFractionDigits: 2, 
                          maximumFractionDigits: 2 
                        })}
                      </div>
                      <div className="text-xs text-green-600 dark:text-green-400">Основной долг</div>
                    </div>
                    <div className="text-center p-3 bg-orange-50 dark:bg-orange-950 rounded-lg">
                      <div className="text-lg font-bold text-orange-600 dark:text-orange-400 break-words">
                        {summary.totalInterest.toLocaleString('ru-RU', { 
                          minimumFractionDigits: 2, 
                          maximumFractionDigits: 2 
                        })}
                      </div>
                      <div className="text-xs text-orange-600 dark:text-orange-400">Проценты</div>
                    </div>
                    <div className="text-center p-3 bg-purple-50 dark:bg-purple-950 rounded-lg">
                      <div className="text-lg font-bold text-purple-600 dark:text-purple-400 break-words">
                        {summary.monthlyPayment.toLocaleString('ru-RU', { 
                          minimumFractionDigits: 2, 
                          maximumFractionDigits: 2 
                        })}
                      </div>
                      <div className="text-xs text-purple-600 dark:text-purple-400">Ежемесячный платёж</div>
                    </div>
                  </div>
                  
                  <div className="text-center mb-4">
                    <Badge variant="secondary" className="text-base px-3 py-1">
                      Срок кредита: {summary.loanTerm}
                    </Badge>
                  </div>

                  {/* Кнопка графика платежей */}
                  <Dialog open={isChartOpen} onOpenChange={setIsChartOpen}>
                    <DialogTrigger asChild>
                      <Button className="w-full" variant="outline" onClick={() => setIsChartOpen(true)}>
                        <BarChart3Icon className="h-4 w-4 mr-2" />
                        Открыть график платежей
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-4xl max-h-[90vh] overflow-auto">
                      <DialogHeader>
                        <DialogTitle>График платежей</DialogTitle>
                      </DialogHeader>
                      <div className="mt-4">
                        <ChartContainer
                          config={chartConfig}
                          className="aspect-auto h-[400px] w-full"
                        >
                          <AreaChart
                            data={groupedData.map((value ) => ({
                              paymentDate: format(value.paymentDate, "yyyy-MM"),
                              paymentAmount: Number(
                                value.paymentAmount.toFixed(roundingDecimals)
                              ),
                              interestAmount: Number(
                                value.interestAmount.toFixed(roundingDecimals)
                              ),
                            }))}
                          >
                            <defs>
                              <linearGradient
                                id="fillPaymentAmount"
                                x1="0"
                                y1="0"
                                x2="0"
                                y2="1"
                              >
                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
                                <stop offset="95%" stopColor="#10b981" stopOpacity={0.1} />
                              </linearGradient>
                              <linearGradient
                                id="fillInterestAmount"
                                x1="0"
                                y1="0"
                                x2="0"
                                y2="1"
                              >
                                <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.8} />
                                <stop offset="95%" stopColor="#60a5fa" stopOpacity={0.1} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid vertical={false} />
                            <XAxis
                              dataKey="paymentDate"
                              tickLine={false}
                              axisLine={false}
                              tickMargin={8}
                              minTickGap={32}
                              tickFormatter={(value) => {
                                const date = new Date(value);
                                return date.toLocaleDateString('ru-RU', {
                                  month: "short",
                                  year: "numeric",
                                });
                              }}
                            />
                            <ChartTooltip
                              content={
                                <ChartTooltipContent
                                  labelFormatter={(value) => {
                                    return new Date(value).toLocaleDateString('ru-RU', {
                                      month: "long",
                                      year: "numeric",
                                    });
                                  }}
                                  indicator="dot"
                                />
                              }
                              cursor={false}
                              defaultIndex={1}
                            />
                            <Area
                              dataKey="paymentAmount"
                              type="linear"
                              fill="url(#fillPaymentAmount)"
                              stroke="#10b981"
                            />
                            <Area
                              dataKey="interestAmount"
                              type="linear"
                              fill="url(#fillInterestAmount)"
                              stroke="#60a5fa"
                            />
                            <ChartLegend content={<ChartLegendContent />} />
                          </AreaChart>
                        </ChartContainer>
                      </div>
                    </DialogContent>
                  </Dialog>
                </CardContent>
              </Card>
            </div>

            {/* Таблица платежей */}
            <Card>
              <CardHeader>
                <CardTitle>Таблица платежей</CardTitle>
                <CardDescription>
                  Детальный график платежей по кредиту
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="max-h-96 overflow-auto">
                  <DataTable
                    columns={columns}
                    data={data.map((item, index) => ({
                      month: index + 1,
                      paymentDate: format(item.paymentDate, "dd.MM.yyyy"),
                      paymentAmount: item.paymentAmount.toFixed(roundingDecimals),
                      principalAmount: item.principalAmount.toFixed(roundingDecimals),
                      interestAmount: item.interestAmount.toFixed(roundingDecimals),
                      remainingPrincipal: item.remainingPrincipal.toFixed(roundingDecimals),
                      isEarlyRepayment: item.isEarlyRepayment,
                    }))}
                    meta={{
                      getRowStyles: (row: Row<LoanScheduleRow>): CSSProperties & { className?: string } => ({
                        className : row.original.isEarlyRepayment ? "bg-accent" : undefined,
                      }),
                      getCellSuffix: (cell) => {
                        const isNumberColumn = cell.column.id === "month";
                        const original = cell.row.original as LoanScheduleRow;
                        if (!isNumberColumn || !original.isEarlyRepayment) return null;
                        return (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex items-center text-primary">
                                  <CalendarCheck2Icon className="h-4 w-4" />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                Досрочное погашение
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        );
                      }
                    }}
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Футер */}
        <footer className="mt-16 pt-8 border-t border-slate-200 dark:border-slate-700">
          <div className="text-center text-sm text-slate-600 dark:text-slate-400">
            <p className="mb-2">
              © 2025 DimmKG. Лицензия AGPL-3.0
            </p>
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
