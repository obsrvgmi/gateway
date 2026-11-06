import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { LazyToaster } from "@/components/lazy-toaster";
import { SITE } from "@/lib/site";
import "@/styles/globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], axes: ["opsz"] });

export const metadata: Metadata = {
  title: { default: `${SITE.name}: accept any crypto`, template: `%s | ${SITE.name}` },
  description: "Payment links and an embeddable checkout. Customers pay with any crypto, you receive the asset you want. Powered by NEAR Intents.",
};

// Applies the saved theme before first paint, to avoid a flash of light mode.
const themeScript = `try{if(localStorage.getItem("boardui:theme")==="dark")document.documentElement.classList.add("dark")}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-full flex-col">
        {children}
        <LazyToaster />
      </body>
    </html>
  );
}
