import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Tower",
  description: "Warden runs a building of worker agents. Each floor is a business.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
