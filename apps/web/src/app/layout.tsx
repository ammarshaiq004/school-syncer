import type { Metadata, Viewport } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import { Providers } from "@/components/providers";
import { THEME_SCRIPT } from "@/lib/theme-script";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], display: "swap", variable: "--font-jakarta" });

export const metadata: Metadata = {
  title: { default: "SchoolSyncer", template: "%s · SchoolSyncer" },
  description: "Run every school operation from one place.",
};

export const viewport: Viewport = {
  // The theme is chosen in the app (light by default), not by the OS, so one colour fits.
  themeColor: "#f8fafc",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${jakarta.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh bg-bg font-sans text-fg">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
