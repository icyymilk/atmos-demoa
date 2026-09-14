import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Atmos — 从想法到应用",
  description: "与 AI 一起创造可运行的网页应用。实时预览、数据保存、版本历史与源码导出。",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
