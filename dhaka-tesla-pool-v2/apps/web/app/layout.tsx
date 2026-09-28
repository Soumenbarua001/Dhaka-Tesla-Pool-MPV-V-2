import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dhaka Tesla Pool",
  description: "Share a seat. Split the fare. Survive Dhaka traffic.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link className="brand" href="/">DTP</Link>
          <nav>
            <Link href="/passenger">Passenger</Link>
            <Link href="/driver">Driver</Link>
            <Link href="/login">Sign in</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
