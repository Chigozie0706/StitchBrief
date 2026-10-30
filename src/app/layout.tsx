import type { Metadata } from "next";
import { DM_Sans, Playfair_Display } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-dm-sans", display: "swap" });
const playfair = Playfair_Display({ subsets: ["latin"], weight: ["500", "600"], style: ["normal", "italic"], variable: "--font-playfair", display: "swap" });

export const metadata: Metadata = {
  title: "StitchBrief",
  description:
    "Helps fashion designers turn outfit references and client requests into editable sewing briefs with clear observations, confirmed details, and open questions.",
  robots: { index: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${dmSans.variable} ${playfair.variable}`}>
      <body>{children}</body>
    </html>
  );
}
