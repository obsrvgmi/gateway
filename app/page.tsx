import { Hero } from "@/components/marketing/hero";
import { Products } from "@/components/marketing/products";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteNav } from "@/components/marketing/site-nav";
import "@/styles/landing.css";

export default function LandingPage() {
  return (
    <div className="site relative flex min-h-dvh flex-col">
      <SiteNav />
      <main>
        <Hero />
        <Products />
      </main>
      <SiteFooter />
    </div>
  );
}
