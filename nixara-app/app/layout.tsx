import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import NavTabs from "@/components/NavTabs";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Nixara",
  description: "Turn raw business data into executive-grade AI reports in seconds.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} antialiased`}>
      <body className="min-h-full flex flex-col">
        <div className="mx-auto w-full max-w-[1200px] px-6 pt-8 pb-12">
          <Header />
          <NavTabs />
          {children}
        </div>
      </body>
    </html>
  );
}
