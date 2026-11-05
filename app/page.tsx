import { Hero } from "@/components/marketing/hero";
import { Products, SiteFooter } from "@/components/marketing/products";
import { SiteNav } from "@/components/marketing/site-nav";

export default function LandingPage() {
  return (
    <div className="relative flex min-h-dvh flex-col">
      <SiteNav />
      <Hero />
      <Products />
      <SiteFooter />
    </div>
  );
}
