import type { Metadata } from "next";
import "./globals.css";
import { AutoConfigProvider } from "@/components/auto-config-provider";

export const metadata: Metadata = {
  title: "Northflow Dashboard",
  description: "Payment Orchestration Dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <AutoConfigProvider>
          {children}
        </AutoConfigProvider>
      </body>
    </html>
  );
}
