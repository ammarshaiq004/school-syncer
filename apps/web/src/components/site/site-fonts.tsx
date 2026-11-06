import {
  DM_Sans, Fraunces, Fredoka, Noto_Nastaliq_Urdu, Nunito, Outfit, Playfair_Display, Public_Sans, Source_Sans_3,
} from "next/font/google";
import type { ReactNode } from "react";

// A school picks one pairing; the browser downloads only the files the chosen pairing uses.
const fraunces = Fraunces({ subsets: ["latin"], display: "swap", variable: "--f-fraunces" });
const publicSans = Public_Sans({ subsets: ["latin"], display: "swap", variable: "--f-public" });
const playfair = Playfair_Display({ subsets: ["latin"], display: "swap", variable: "--f-playfair" });
const source = Source_Sans_3({ subsets: ["latin"], display: "swap", variable: "--f-source" });
const fredoka = Fredoka({ subsets: ["latin"], display: "swap", variable: "--f-fredoka" });
const nunito = Nunito({ subsets: ["latin"], display: "swap", variable: "--f-nunito" });
const outfit = Outfit({ subsets: ["latin"], display: "swap", variable: "--f-outfit" });
const dmSans = DM_Sans({ subsets: ["latin"], display: "swap", variable: "--f-dmsans" });
const nastaliq = Noto_Nastaliq_Urdu({ subsets: ["arabic"], display: "swap", variable: "--f-nastaliq" });

const CLASSES = [fraunces, publicSans, playfair, source, fredoka, nunito, outfit, dmSans, nastaliq].map((f) => f.variable).join(" ");

/** Loads the website fonts and exposes them as CSS variables for everything inside. */
export function SiteFonts({ children }: { children: ReactNode }) {
  return <div className={CLASSES}>{children}</div>;
}
