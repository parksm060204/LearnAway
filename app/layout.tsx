import type { Metadata } from "next";
import "./globals.css";
import { AppSplash } from "../components/AppSplash";

export const metadata: Metadata = {
  title: "Learn my way ACADEMIC | 대학 논술·서술형 스페이스드 리피티션 학습 도구",
  description:
    "수리통계 및 알고리즘 대학 논술·서술형 시험 대비 동적 망각곡선 및 루브릭 정밀 첨삭 학습 도구",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <head>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Font stylesheets are imported in globals.css to avoid per-page font links. */}
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <AppSplash />
      </body>
    </html>
  );
}
