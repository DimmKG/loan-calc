import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { format } from "date-fns"
import type { LoanScheduleEntry } from "./loan-lib"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function generateLoanScheduleCSV(
  data: LoanScheduleEntry[],
  roundingDecimals: number
): string {
  if (data.length === 0) return "";

  // Заголовки CSV
  const headers = ["№", "Дата", "Платеж", "Основной долг", "Проценты", "Остаток"];
  
  // Создаем строки данных
  const rows = data.map((item) => {
    const monthNumber = item.isEarlyRepayment 
      ? `${item.monthNumber} ДП`
      : item.monthNumber.toString();
    
    return [
      monthNumber,
      format(item.paymentDate, "dd.MM.yyyy"),
      item.paymentAmount.toFixed(roundingDecimals),
      item.principalAmount.toFixed(roundingDecimals),
      item.interestAmount.toFixed(roundingDecimals),
      item.remainingPrincipal.toFixed(roundingDecimals),
    ];
  });

  // Объединяем заголовки и данные
  const csvContent = [
    headers.join(","),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(","))
  ].join("\n");

  // Добавляем BOM для правильного отображения кириллицы в Excel
  const BOM = "\uFEFF";
  return BOM + csvContent;
}
