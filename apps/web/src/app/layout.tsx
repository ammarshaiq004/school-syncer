import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SchoolSyncer",
  description: "Run every school operation from one place.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
