import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";
import Providers from "./providers";

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["400", "600", "800"],
});

export const metadata: Metadata = {
  title: "Nomikai",
  description: "Log what you drank, where, and when.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${archivo.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Providers>
          <div className="app-shell mx-auto flex min-h-dvh w-full max-w-[430px] flex-col">
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
}
