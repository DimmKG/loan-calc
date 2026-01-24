import { ColumnDef, Row } from "@tanstack/react-table";
import { DataTable } from "../../components/ui/data-table";
import { CSSProperties, MouseEventHandler } from "react";
import { TooltipTrigger } from "@radix-ui/react-tooltip";
import { Tooltip, TooltipContent } from "../../components/ui/tooltip";
import { CalendarCheck2Icon, Download } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Button } from "../../components/ui/button";

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

interface LoanScheduleRow {
  month: number;
  paymentDate: string;
  paymentAmount: string;
  principalAmount: string;
  interestAmount: string;
  remainingPrincipal: string;
  isEarlyRepayment: boolean;
}

export default function PaymentsTableCard({
  data,
  onExportClick,
}: {
  data: LoanScheduleRow[];
  onExportClick: MouseEventHandler<HTMLButtonElement>;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-start">
          <div>
            <CardTitle>Таблица платежей</CardTitle>
            <CardDescription>
              Детальный график платежей по кредиту
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onExportClick}
            title="Экспортировать таблицу в CSV"
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Экспорт CSV</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="max-h-96 overflow-auto">
          <DataTable
            columns={columns}
            data={data}
            meta={{
              getRowStyles: (
                row: Row<LoanScheduleRow>
              ): CSSProperties & { className?: string } => ({
                className: row.original.isEarlyRepayment
                  ? "bg-accent"
                  : undefined,
              }),
              getCellSuffix: (cell) => {
                const isNumberColumn = cell.column.id === "month";
                const original = cell.row.original as LoanScheduleRow;
                if (!isNumberColumn || !original.isEarlyRepayment) return null;
                return (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex items-center text-primary">
                        <CalendarCheck2Icon className="h-4 w-4" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>Досрочное погашение</TooltipContent>
                  </Tooltip>
                );
              },
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
