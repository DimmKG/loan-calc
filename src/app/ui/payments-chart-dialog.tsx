import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "../../components/ui/chart";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { BarChart3Icon } from "lucide-react";

export interface ChartGroupedData {
  paymentDate: string;
  principalAmount: number;
  interestAmount: number;
}

const chartConfig = {
  principalAmount: {
    label: "Основной долг",
    color: "#10b981",
  },
  interestAmount: {
    label: "Проценты",
    color: "#60a5fa",
  },
} satisfies ChartConfig;

export default function PaymentsChartDialog({
  groupedData,
  isChartOpen,
  setIsChartOpen,
}: {
  groupedData: ChartGroupedData[];
  isChartOpen: boolean;
  setIsChartOpen: (open: boolean) => void;
}) {
  return (
    <Dialog open={isChartOpen} onOpenChange={setIsChartOpen}>
      <DialogTrigger asChild>
        <Button
          className="w-full"
          variant="outline"
          onClick={() => setIsChartOpen(true)}
        >
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
            <AreaChart data={groupedData}>
              <defs>
                <linearGradient
                  id="fillPrincipalAmount"
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
                  return date.toLocaleDateString("ru-RU", {
                    month: "short",
                    year: "numeric",
                  });
                }}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) => {
                      return new Date(value).toLocaleDateString("ru-RU", {
                        month: "long",
                        year: "numeric",
                      });
                    }}
                    valueFormatter={(value) =>
                      value.toLocaleString("ru-RU", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })
                    }
                    indicator="dot"
                  />
                }
                cursor={false}
                defaultIndex={1}
              />
              <Area
                dataKey="principalAmount"
                type="linear"
                fill="url(#fillPrincipalAmount)"
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
  );
}
