import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import { AppThemeProvider } from "@/components/theme-provider";
import "./globals.css";
import "./rebuild.css";
import "./refactor.css";
import { MobileNav, PreferenceSync } from "@/components/shell/app-shell";
import { MetricsRoutePing } from "@/components/metrics-route-ping";
import { AccountProvider } from "@/components/account-provider";
import { OG_IMAGE_URL, serializeJsonLd, SITE_DESCRIPTION, SITE_DESCRIPTION_EN, SITE_NAME, SITE_URL, siteUrl } from "@/lib/site-config";

/* Archivo sets every heading and IBM Plex Mono every number the product
 * reports. next/font self-hosts both, so there is no third-party connection
 * and no metric swap after paint. Archivo is loaded as a variable font because
 * the display tier uses 620 and 640 -- weights no static cut carries.
 * Neither face has han glyphs; CJK stays on the system stack behind them. */
const archivo = Archivo({ subsets: ["latin"], display: "swap", variable: "--font-archivo" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], display: "swap", variable: "--font-plex-mono" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "认识你自己 | Know Yourself", template: "%s | Know Yourself" },
  description: `${SITE_DESCRIPTION} ${SITE_DESCRIPTION_EN}`,
  alternates: { canonical: "/" },
  keywords: ["自我反思", "人格测试", "情绪", "关系", "self reflection", "personality quiz"],
  authors: [{ name: "Know Yourself" }],
  manifest: "/manifest.json",
  openGraph: {
    title: "认识你自己 | Know Yourself",
    description: SITE_DESCRIPTION,
    siteName: SITE_NAME,
    locale: "zh_CN",
    alternateLocale: ["en_US"],
    type: "website",
    url: siteUrl("/"),
    images: [{ url: OG_IMAGE_URL, width: 1200, height: 630, alt: "认识你自己 | Know Yourself" }],
  },
  twitter: { card: "summary_large_image", title: "认识你自己 | Know Yourself", description: SITE_DESCRIPTION_EN, images: [OG_IMAGE_URL] },
  robots: { index: true, follow: true },
  other: { "apple-mobile-web-app-capable": "yes", "apple-mobile-web-app-status-bar-style": "default", "apple-mobile-web-app-title": "认识你自己" },
};

export const viewport: Viewport = { themeColor: [{ media: "(prefers-color-scheme: light)", color: "#FAFBFD" }, { media: "(prefers-color-scheme: dark)", color: "#1B1C23" }], colorScheme: "light dark" };

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "认识你自己",
  alternateName: "Know Yourself",
  url: SITE_URL,
  description: `${SITE_DESCRIPTION} ${SITE_DESCRIPTION_EN}`,
  inLanguage: ["zh-CN", "en"],
};

const preferenceScript = `(function(){try{var raw=localStorage.getItem('know-yourself:v3');var data=raw?JSON.parse(raw):null;var p=data&&data.version===3?data.preferences:null;var theme=p&&p.theme?p.theme:'system';var dark=theme==='dark'||(theme==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',dark);document.documentElement.style.colorScheme=dark?'dark':'light';document.documentElement.lang=p&&p.lang==='en'?'en':'zh-CN';}catch(e){}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className={`${archivo.variable} ${plexMono.variable} h-full antialiased`} data-scroll-behavior="smooth" suppressHydrationWarning>
      <head><link rel="apple-touch-icon" href="/icons/icon-192.svg" /><script dangerouslySetInnerHTML={{ __html: preferenceScript }} /><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }} /></head>
      <body className="min-h-full bg-paper font-sans text-ink dark:bg-night dark:text-white"><a className="skip-link" href="#main-content">跳到主要内容 / Skip to main content</a><AppRouterCacheProvider><AppThemeProvider><AccountProvider><PreferenceSync /><MetricsRoutePing />{children}<MobileNav /></AccountProvider></AppThemeProvider></AppRouterCacheProvider></body>
    </html>
  );
}
