"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { LoanInputForm } from "@/types/loan-input-form.type";
import { useForm } from "react-hook-form";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronsUpDown, Plus, Trash2, Download, Upload, Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCallback, useEffect, useState } from "react";
import { FormMessage } from "@/components/ui/form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Resolver } from "react-hook-form";
import { format } from "date-fns";

const earlyRepaymentSchema = z.object({
  id: z.string(),
  earlyRepaymentDateStart: z.coerce.date(),
  earlyRepaymentDateEnd: z.coerce.date().optional(),
  periodicity: z.enum(["ONCE", "MONTHLY", "QUARTERLY", "YEARLY"]),
  earlyRepaymentAmount: z.coerce
    .number()
    .positive("Сумма должна быть больше 0"),
  repaymentType: z.enum(["DECREASE_TERM", "DECREASE_PAYMENT"]),
  syncWithPaymentDate: z.boolean().optional(),
});

const PERIODICITY_LABELS: Record<string, string> = {
  ONCE: "один раз",
  MONTHLY: "ежемесячно",
  QUARTERLY: "ежеквартально",
  YEARLY: "ежегодно",
};

const REPAYMENT_TYPE_LABELS: Record<string, string> = {
  DECREASE_PAYMENT: "уменьшение платежа",
  DECREASE_TERM: "уменьшение срока",
};

function formatEarlyRepaymentSummary(er: {
  earlyRepaymentAmount?: number;
  periodicity?: string;
  repaymentType?: string;
  earlyRepaymentDateStart: Date;
}): string {
  const amount =
    er.earlyRepaymentAmount != null
      ? `${er.earlyRepaymentAmount.toLocaleString("ru-RU")} ₽`
      : "—";
  const periodicity = er.periodicity ? PERIODICITY_LABELS[er.periodicity] : "";
  const repaymentType = er.repaymentType
    ? REPAYMENT_TYPE_LABELS[er.repaymentType]
    : "";
  const date = er.earlyRepaymentDateStart
    ? format(er.earlyRepaymentDateStart, "dd.MM.yyyy")
    : "";
  return [amount, periodicity, repaymentType, date && `с ${date}`]
    .filter(Boolean)
    .join(" · ");
}

export default function LoanInputCard({
  onFormSubmit,
}: {
  onFormSubmit?: (data: LoanInputForm) => void;
}) {
  const LOCAL_STORAGE_KEY = "loan-input-form-settings";

  const schema = z
    .object({
      loanAmount: z.coerce.number().gt(0, "Сумма должна быть больше 0"),
      loanTerm: z.coerce
        .number()
        .int("Срок должен быть целым числом")
        .gt(0, "Срок должен быть больше 0"),
      loanTermType: z.enum(["y", "m"]),
      interestRate: z.coerce
        .number()
        .min(0, "Ставка не может быть отрицательной"),
      loanType: z.enum(["ANNUITY", "AMORTIZATION"]),
      interestOnlyFirstPeriod: z.boolean().optional(),
      interestOnlyPeriodExtendsTerm: z.boolean().optional(),
      moveHolidayToNextDay: z.boolean().optional(),
      fullInterestModeling: z.boolean().optional(),
      interestModelingHorizonMonths: z.union([
        z.coerce
          .number()
          .int("Должно быть целым числом")
          .positive("Должно быть больше 0"),
        z.undefined(),
      ]),
      dayCountBasis: z
        .enum(["ACTUAL_365", "ACTUAL_360", "ACTUAL_ACTUAL"])
        .optional(),
      roundingDecimals: z.union([
        z.coerce
          .number()
          .int("Должно быть целым числом")
          .min(0, "Минимум 0")
          .max(10, "Максимум 10"),
        z.undefined(),
      ]),
      issueDate: z.coerce.date(),
      paymentDayNumber: z.coerce
        .number()
        .int("Должно быть целым числом")
        .min(1, "Минимум 1")
        .max(31, "Максимум 31"),
      earlyRepayments: z.array(earlyRepaymentSchema),
    })
    .superRefine((val, ctx) => {
      if (!(val.issueDate instanceof Date) || isNaN(val.issueDate.getTime())) {
        ctx.addIssue({
          code: "custom",
          path: ["issueDate"],
          message: "Неверная дата",
        });
      }
    });

  const defaultValues: LoanInputForm = {
    loanAmount: 100000,
    loanTerm: 12,
    loanTermType: "m",
    loanType: "ANNUITY",
    interestRate: 10,
    interestOnlyFirstPeriod: false,
    interestOnlyPeriodExtendsTerm: false,
    dayCountBasis: "ACTUAL_ACTUAL",
    roundingDecimals: 2,
    issueDate: new Date(),
    paymentDayNumber: 20,
    moveHolidayToNextDay: false,
    fullInterestModeling: true,
    interestModelingHorizonMonths: undefined,
    earlyRepayments: [],
  };

  // Берём начальные значения из localStorage или используем значения по умолчанию
  const getInitialValues = (): LoanInputForm => {
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (!raw) {
        return defaultValues;
      }

      const parsed = JSON.parse(raw);
      return {
        loanAmount: Number(parsed.loanAmount) || 100000,
        loanTerm: Number(parsed.loanTerm) || 12,
        loanTermType: parsed.loanTermType === "y" ? "y" : "m",
        loanType:
          parsed.loanType === "AMORTIZATION" ? "AMORTIZATION" : "ANNUITY",
        interestRate: Number(parsed.interestRate) || 10,
        dayCountBasis: ["ACTUAL_365", "ACTUAL_360", "ACTUAL_ACTUAL"].includes(
          parsed.dayCountBasis
        )
          ? parsed.dayCountBasis
          : "ACTUAL_ACTUAL",
        roundingDecimals:
          parsed.roundingDecimals === "" || parsed.roundingDecimals == null
            ? 2
            : Number(parsed.roundingDecimals),
        issueDate: parsed.issueDate ? new Date(parsed.issueDate) : new Date(),
        paymentDayNumber: parsed.paymentDayNumber
          ? Number(parsed.paymentDayNumber)
          : 20,
        interestOnlyFirstPeriod: Boolean(parsed.interestOnlyFirstPeriod),
        interestOnlyPeriodExtendsTerm: Boolean(
          parsed.interestOnlyPeriodExtendsTerm
        ),
        moveHolidayToNextDay: Boolean(parsed.moveHolidayToNextDay),
        // Отсутствие поля (старые сохранённые настройки до появления этой
        // фичи) трактуется как "не выключено явно" -> точное моделирование.
        fullInterestModeling: parsed.fullInterestModeling !== false,
        interestModelingHorizonMonths: parsed.interestModelingHorizonMonths
          ? Number(parsed.interestModelingHorizonMonths)
          : undefined,
        earlyRepayments: (parsed.earlyRepayments || []).map((er: any) => ({
          id: er.id || `er-${Date.now()}-${Math.random()}`,
          earlyRepaymentDateStart: er.earlyRepaymentDateStart
            ? new Date(er.earlyRepaymentDateStart)
            : new Date(),
          earlyRepaymentDateEnd: er.earlyRepaymentDateEnd
            ? new Date(er.earlyRepaymentDateEnd)
            : undefined,
          periodicity: er.periodicity || "MONTHLY",
          earlyRepaymentAmount: er.earlyRepaymentAmount || 0,
          repaymentType: er.repaymentType || "DECREASE_PAYMENT",
          syncWithPaymentDate: Boolean(er.syncWithPaymentDate),
        })),
      };
    } catch (error) {
      console.warn("Failed to load saved loan settings, using defaults", error);
      return defaultValues;
    }
  };

  const form = useForm<LoanInputForm>({
    resolver: zodResolver(schema) as unknown as Resolver<LoanInputForm>,
    defaultValues: getInitialValues(),
  });

  // Локальное UI-состояние "какие карточки досрочного погашения раскрыты".
  // Не часть формы: не сохраняется в localStorage и не участвует в
  // экспорте/импорте. Карточки, загруженные при монтировании, свёрнуты по
  // умолчанию; свежедобавленная карточка сразу открывается.
  const [openEarlyRepaymentIds, setOpenEarlyRepaymentIds] = useState<
    Set<string>
  >(new Set());

  // Сохраняем настройки в localStorage при любом изменении
  useEffect(() => {
    const subscription = form.watch((value) => {
      try {
        localStorage.setItem(
          LOCAL_STORAGE_KEY,
          JSON.stringify({
            ...value,
            issueDate: format(value.issueDate, "yyyy-MM-dd"),
            earlyRepayments: (value.earlyRepayments || []).map((er) => ({
              id: er.id,
              earlyRepaymentDateStart: er.earlyRepaymentDateStart
                ? format(er.earlyRepaymentDateStart, "yyyy-MM-dd")
                : undefined,
              earlyRepaymentDateEnd: er.earlyRepaymentDateEnd
                ? format(er.earlyRepaymentDateEnd, "yyyy-MM-dd")
                : undefined,
              periodicity: er.periodicity,
              earlyRepaymentAmount: er.earlyRepaymentAmount,
              repaymentType: er.repaymentType,
              syncWithPaymentDate: er.syncWithPaymentDate,
            })),
          })
        );
      } catch (error) {
        console.warn("Failed to save loan settings", error);
      }
    });
    return () => subscription.unsubscribe();
  }, [form]);

  const addEarlyRepayment = useCallback(() => {
    const newId = `er-${Date.now()}`;
    const currentEarlyRepayments = form.getValues("earlyRepayments") || [];
    form.setValue("earlyRepayments", [
      ...currentEarlyRepayments,
      {
        id: newId,
        earlyRepaymentDateStart: new Date(),
        periodicity: "MONTHLY" as const,
        repaymentType: "DECREASE_PAYMENT" as const,
        earlyRepaymentAmount: 0,
        syncWithPaymentDate: false,
      },
    ]);
    setOpenEarlyRepaymentIds((prev) => new Set(prev).add(newId));
  }, [form]);

  const removeEarlyRepayment = useCallback((id: string) => {
    const currentEarlyRepayments = form.getValues("earlyRepayments") || [];
    form.setValue(
      "earlyRepayments",
      currentEarlyRepayments.filter((er) => er.id !== id)
    );
    setOpenEarlyRepaymentIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, [form]);

  const toggleEarlyRepaymentOpen = useCallback((id: string, open: boolean) => {
    setOpenEarlyRepaymentIds((prev) => {
      const next = new Set(prev);
      if (open) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  function onSubmit(data: LoanInputForm) {
    onFormSubmit?.(data);
  }

  const handleExport = () => {
    const formData = form.getValues();
    const exportData = {
      ...formData,
      issueDate: format(formData.issueDate, "yyyy-MM-dd"),
      earlyRepayments: (formData.earlyRepayments || []).map((er) => ({
        id: er.id,
        earlyRepaymentDateStart: format(er.earlyRepaymentDateStart, "yyyy-MM-dd"),
        earlyRepaymentDateEnd: er.earlyRepaymentDateEnd
          ? format(er.earlyRepaymentDateEnd, "yyyy-MM-dd")
          : undefined,
        periodicity: er.periodicity,
        earlyRepaymentAmount: er.earlyRepaymentAmount,
        repaymentType: er.repaymentType,
        syncWithPaymentDate: er.syncWithPaymentDate,
      })),
    };

    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `loan-settings-${format(new Date(), "yyyy-MM-dd")}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const jsonString = e.target?.result as string;
        const importedData = JSON.parse(jsonString);

        // Преобразуем данные в формат формы
        const formData: LoanInputForm = {
          loanAmount: Number(importedData.loanAmount) || 100000,
          loanTerm: Number(importedData.loanTerm) || 12,
          loanTermType: importedData.loanTermType === "y" ? "y" : "m",
          loanType:
            importedData.loanType === "AMORTIZATION" ? "AMORTIZATION" : "ANNUITY",
          interestRate: Number(importedData.interestRate) || 10,
          dayCountBasis: ["ACTUAL_365", "ACTUAL_360", "ACTUAL_ACTUAL"].includes(
            importedData.dayCountBasis
          )
            ? importedData.dayCountBasis
            : "ACTUAL_ACTUAL",
          roundingDecimals:
            importedData.roundingDecimals === "" ||
            importedData.roundingDecimals == null
              ? 2
              : Number(importedData.roundingDecimals),
          issueDate: importedData.issueDate
            ? new Date(importedData.issueDate)
            : new Date(),
          paymentDayNumber: importedData.paymentDayNumber
            ? Number(importedData.paymentDayNumber)
            : 20,
          interestOnlyFirstPeriod: Boolean(importedData.interestOnlyFirstPeriod),
          interestOnlyPeriodExtendsTerm: Boolean(
            importedData.interestOnlyPeriodExtendsTerm
          ),
          moveHolidayToNextDay: Boolean(importedData.moveHolidayToNextDay),
          fullInterestModeling: importedData.fullInterestModeling !== false,
          interestModelingHorizonMonths: importedData.interestModelingHorizonMonths
            ? Number(importedData.interestModelingHorizonMonths)
            : undefined,
          earlyRepayments: (importedData.earlyRepayments || []).map((er: any) => ({
            id: er.id || `er-${Date.now()}-${Math.random()}`,
            earlyRepaymentDateStart: er.earlyRepaymentDateStart
              ? new Date(er.earlyRepaymentDateStart)
              : new Date(),
            earlyRepaymentDateEnd: er.earlyRepaymentDateEnd
              ? new Date(er.earlyRepaymentDateEnd)
              : undefined,
            periodicity: er.periodicity || "MONTHLY",
            earlyRepaymentAmount: er.earlyRepaymentAmount || 0,
            repaymentType: er.repaymentType || "DECREASE_PAYMENT",
            syncWithPaymentDate: Boolean(er.syncWithPaymentDate),
          })),
        };

        // Заполняем форму
        form.reset(formData);

        // Автоматически запускаем расчет
        setTimeout(() => {
          form.handleSubmit(onSubmit)();
        }, 100);
      } catch (error) {
        console.error("Ошибка при импорте файла:", error);
        alert("Ошибка при импорте файла");
      }
    };
    reader.readAsText(file);
    // Сбрасываем значение input, чтобы можно было загрузить тот же файл снова
    event.target.value = "";
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle className="text-xl">Настройки кредита</CardTitle>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleExport}
              title="Экспортировать настройки в JSON"
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Экспорт</span>
            </Button>
            <div>
              <input
                id="import-file-input"
                type="file"
                accept=".json"
                onChange={handleImport}
                className="hidden"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => document.getElementById("import-file-input")?.click()}
                title="Импортировать настройки из JSON"
              >
                <Upload className="h-4 w-4" />
                <span className="hidden sm:inline">Импорт</span>
              </Button>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            {/* Основные параметры в сетке */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
              <FormField
                control={form.control}
                name="loanAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Размер кредита</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="100000" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-2">
                <div className="flex gap-2">
                  <FormField
                    control={form.control}
                    name="loanTerm"
                    render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormLabel className="text-sm font-medium">
                          Срок кредита
                        </FormLabel>
                        <FormControl>
                          <Input type="number" placeholder="12" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="loanTermType"
                    render={({ field }) => (
                      <FormItem className="w-24 mt-6">
                        <FormLabel className="sr-only">
                          Периодичность кредита
                        </FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          defaultValue={field.value}
                        >
                          <SelectTrigger>
                            <FormControl>
                              <SelectValue />
                            </FormControl>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="y">лет</SelectItem>
                            <SelectItem value="m" aria-label="месяцев">
                              мес.
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <FormField
                control={form.control}
                name="interestRate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Процентная ставка (%)</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="10" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="loanType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Тип платежа</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <SelectTrigger>
                        <FormControl>
                          <SelectValue />
                        </FormControl>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ANNUITY">Аннуитетный</SelectItem>
                        <SelectItem value="AMORTIZATION">
                          Дифференцированный
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="issueDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Дата выдачи кредита</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        value={
                          field.value ? format(field.value, "yyyy-MM-dd") : ""
                        }
                        onChange={field.onChange}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="paymentDayNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>День платежа</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="20" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Досрочные погашения */}
            <Collapsible className="mb-6" defaultOpen>
              <div className="flex justify-between items-center gap-2 mb-3">
                <h4 className="text-sm font-semibold">
                  Досрочные погашения
                  {(form.watch("earlyRepayments")?.length ?? 0) > 0 && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      ({form.watch("earlyRepayments")?.length})
                    </span>
                  )}
                </h4>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-8">
                    <ChevronsUpDown />
                    <span className="sr-only">Toggle</span>
                  </Button>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent>
                <div className="space-y-4">
                  {form.watch("earlyRepayments")?.map((er, index) => {
                    const isOpen = openEarlyRepaymentIds.has(er.id);
                    return (
                    <Collapsible
                      key={er.id}
                      open={isOpen}
                      onOpenChange={(open) =>
                        toggleEarlyRepaymentOpen(er.id, open)
                      }
                      className="p-4 border rounded-lg space-y-4"
                    >
                      <div className="flex justify-between items-center gap-2">
                        <CollapsibleTrigger asChild>
                          <button
                            type="button"
                            className="flex-1 flex items-center justify-between gap-2 text-left"
                          >
                            <div>
                              <span className="text-sm font-medium block">
                                Досрочное погашение
                              </span>
                              {!isOpen && (
                                <span className="text-xs text-muted-foreground">
                                  {formatEarlyRepaymentSummary(er)}
                                </span>
                              )}
                            </div>
                            <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                          </button>
                        </CollapsibleTrigger>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-6 shrink-0"
                          onClick={() => removeEarlyRepayment(er.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      <CollapsibleContent className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name={`earlyRepayments.${index}.earlyRepaymentDateStart`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs text-muted-foreground">
                                Дата начала
                              </FormLabel>
                              <FormControl>
                                <Input
                                  type="date"
                                  value={
                                    field.value
                                      ? format(field.value, "yyyy-MM-dd")
                                      : ""
                                  }
                                  onChange={(e) =>
                                    field.onChange(e.target.valueAsDate)
                                  }
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`earlyRepayments.${index}.earlyRepaymentDateEnd`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs text-muted-foreground">
                                Дата окончания
                              </FormLabel>
                              <FormControl>
                                <Input
                                  type="date"
                                  value={
                                    field.value
                                      ? format(field.value, "yyyy-MM-dd")
                                      : ""
                                  }
                                  onChange={(e) =>
                                    field.onChange(e.target.valueAsDate)
                                  }
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <FormField
                          control={form.control}
                          name={`earlyRepayments.${index}.periodicity`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs text-muted-foreground">
                                Периодичность
                              </FormLabel>
                              <Select
                                onValueChange={field.onChange}
                                defaultValue={field.value}
                              >
                                <FormControl>
                                  <SelectTrigger className="h-9">
                                    <SelectValue />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="ONCE">Один раз</SelectItem>
                                  <SelectItem value="MONTHLY">
                                    Ежемесячно
                                  </SelectItem>
                                  <SelectItem value="QUARTERLY">
                                    Ежеквартально
                                  </SelectItem>
                                  <SelectItem value="YEARLY">
                                    Ежегодно
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`earlyRepayments.${index}.repaymentType`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs text-muted-foreground">
                                Тип погашения
                              </FormLabel>
                              <Select
                                onValueChange={field.onChange}
                                defaultValue={field.value}
                              >
                                <FormControl>
                                  <SelectTrigger className="h-9">
                                    <SelectValue />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="DECREASE_PAYMENT">
                                    Уменьшение платежа
                                  </SelectItem>
                                  <SelectItem value="DECREASE_TERM">
                                    Уменьшение срока
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`earlyRepayments.${index}.earlyRepaymentAmount`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs text-muted-foreground">
                                Сумма досрочного погашения
                              </FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  placeholder="50000"
                                  {...field}
                                  className="h-9"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <FormField
                        control={form.control}
                        name={`earlyRepayments.${index}.syncWithPaymentDate`}
                        render={({ field }) => (
                          <FormItem className="flex items-center gap-2">
                            <FormControl>
                              <Checkbox
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                            <FormLabel className="text-sm">
                              Привязать к дню платежа (учитывать перенос
                              выходных)
                            </FormLabel>
                          </FormItem>
                        )}
                      />
                      </CollapsibleContent>
                    </Collapsible>
                    );
                  })}

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addEarlyRepayment}
                    className="w-full"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Добавить досрочное погашение
                  </Button>
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Дополнительные параметры */}
            <Collapsible className="mb-6" defaultOpen>
              <div className="flex justify-between items-center gap-2 mb-3">
                <h4 className="text-sm font-semibold">
                  Дополнительные параметры
                </h4>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-8">
                    <ChevronsUpDown />
                    <span className="sr-only">Toggle</span>
                  </Button>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="roundingDecimals"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Знаки после запятой</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            placeholder="2"
                            value={field.value ?? ""}
                            onChange={(e) => {
                              const value = e.target.value;
                              field.onChange(
                                value === "" ? undefined : Number(value)
                              );
                            }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="dayCountBasis"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>База расчета дней</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          defaultValue={field.value}
                        >
                          <SelectTrigger>
                            <FormControl>
                              <SelectValue />
                            </FormControl>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ACTUAL_365">
                              365 дней в году
                            </SelectItem>
                            <SelectItem value="ACTUAL_360">
                              360 дней в году
                            </SelectItem>
                            <SelectItem value="ACTUAL_ACTUAL">
                              Фактические дни
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="space-y-3 mt-4">
                  <FormField
                    control={form.control}
                    name="interestOnlyFirstPeriod"
                    render={({ field }) => (
                      <FormItem className="flex items-center gap-2">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <FormLabel className="text-sm">
                          Первый месяц проценты
                        </FormLabel>
                      </FormItem>
                    )}
                  />
                  {form.watch("interestOnlyFirstPeriod") && (
                    <FormField
                      control={form.control}
                      name="interestOnlyPeriodExtendsTerm"
                      render={({ field }) => (
                        <FormItem className="flex items-center gap-2 ml-6">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                          <FormLabel className="text-sm">
                            Льготный месяц увеличивает срок кредита
                          </FormLabel>
                        </FormItem>
                      )}
                    />
                  )}
                  <FormField
                    control={form.control}
                    name="moveHolidayToNextDay"
                    render={({ field }) => (
                      <FormItem className="flex items-center gap-2">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <FormLabel className="text-sm">
                          Перенос выходных
                        </FormLabel>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="fullInterestModeling"
                    render={({ field }) => (
                      <FormItem className="flex items-center gap-2">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <FormLabel className="text-sm flex items-center gap-1">
                          Полное моделирование процента
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              Банки при расчёте платежа моделируют каждый
                              день с учётом переноса дат на будни — это
                              влияет на проценты и итоговую сумму платежа.
                              Отключение возвращает к упрощённой формуле
                              (ставка/12), которая может давать небольшое
                              расхождение с реальным банковским графиком на
                              длинных сроках.
                            </TooltipContent>
                          </Tooltip>
                        </FormLabel>
                      </FormItem>
                    )}
                  />
                  {form.watch("fullInterestModeling") && (
                    <FormField
                      control={form.control}
                      name="interestModelingHorizonMonths"
                      render={({ field }) => (
                        <FormItem className="ml-6 max-w-[260px]">
                          <FormLabel className="text-xs text-muted-foreground">
                            Количество платежей для моделирования
                          </FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              placeholder="весь срок"
                              value={field.value ?? ""}
                              onChange={(e) => {
                                const value = e.target.value;
                                field.onChange(
                                  value === "" ? undefined : Number(value)
                                );
                              }}
                              className="h-9"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Кнопка расчета */}
            <div className="text-center">
              <Button type="submit" size="lg" className="px-8">
                Рассчитать кредит
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
