import type { Metadata } from "next";
import { Inter, Anton } from "next/font/google";
import { ThemeProvider } from "@/components/ThemeProvider";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap", });

const anton = Anton({ weight: "400", subsets: ["latin"], variable: "--font-anton", display: "swap", });

export const metadata: Metadata = { title: "GowTrain", description: "Vind trainers. Boek direct. Gow!", };

export default function RootLayout({ children, }: Readonly<{ children: React.ReactNode; }>) {
  return (

    <html lang="nl" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${anton.variable} font-sans antialiased`}
        suppressHydrationWarning
      >
        <ThemeProvider
          attribute="data-theme"
          defaultTheme="dark"
          enableSystem={false}
        >
          {children}
        </ThemeProvider>
      </body>
    </html>);
}