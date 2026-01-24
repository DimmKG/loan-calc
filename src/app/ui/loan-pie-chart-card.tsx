import { BarChart3Icon } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Cell, Pie, PieChart } from "recharts";

export default function LoanPieChartCard({
  totalPrincipal,
  totalInterest,
}: {
  totalPrincipal: number;
  totalInterest: number;
}) {
  const pieChartData = [
    { name: "Основной долг", value: totalPrincipal },
    { name: "Проценты", value: totalInterest },
  ];
  const COLORS = ["#10b981", "#60a5fa"];
  return (
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
                <Cell
                  key={`cell-${index}`}
                  fill={COLORS[index % COLORS.length]}
                />
              ))}
            </Pie>
          </PieChart>
        </div>

        {/* Легенда с процентами */}
        <div className="mt-6 space-y-3">
          {pieChartData.map((entry, index) => {
            const percentage = (
              (entry.value / (totalPrincipal + totalInterest)) *
              100
            ).toFixed(1);
            return (
              <div
                key={entry.name}
                className="flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-4 h-4 rounded"
                    style={{
                      backgroundColor: COLORS[index % COLORS.length],
                    }}
                  ></div>
                  <span className="text-sm font-medium">{entry.name}</span>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold">
                    {entry.value.toLocaleString("ru-RU", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {percentage}%
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
