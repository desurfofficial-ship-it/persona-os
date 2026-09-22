import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Persona OS",
  description: "AI-powered tools for coherent digital identities",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased bg-zinc-950 text-zinc-100">
        {children}
      </body>
    </html>
  );
}
