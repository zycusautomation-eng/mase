import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Deal Intelligence Engine",
  description: "Sales deal dashboard — Deals, Espresso, Matcha, and Chat over the bundled book of opportunities.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
