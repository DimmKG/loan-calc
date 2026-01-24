import type { ReactNode } from "react";
import "./global.css";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "../components/ui/tooltip";

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <title>Кредитный калькулятор</title>
        <meta
          name="description"
          content="Кредитный калькулятор с досрочными погашениями"
        />
      </head>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider>{children}</TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
