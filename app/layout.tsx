import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SpeakTime — 말한 시간만 세는 영어 회화",
  description: "듀오링고가 못 주는 것: 실제로 입 밖에 낸 시간. 상황 롤플레이와 한국어 구조대로 회화 자동화를 훈련합니다.",
};

export const viewport: Viewport = {
  themeColor: "#0b0d12",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <div className="shell">{children}</div>
      </body>
    </html>
  );
}
