import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import SupportForm from "@/components/SupportForm";

export const metadata: Metadata = {
  title: "Contact | Gowtrain",
  description:
    "Een vraag over Gowtrain? Neem contact met ons op via het contactformulier.",
};

export default function SupportPage() {
  return (
    <div className="flex min-h-screen flex-col bg-[#14171A] text-white">
      <SiteHeader />

      <main className="relative isolate flex-1">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
        >
          <div className="absolute -right-40 top-0 h-96 w-96 rounded-full bg-[#D6FF3F] opacity-[0.06] blur-[100px]" />
        </div>

        <div className="mx-auto max-w-7xl px-5 py-14 sm:px-8 sm:py-20 lg:py-24">
          <div className="grid items-start gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
            <div>
              <p className="font-display text-lg text-[#FF4B3E]">
                WE HELPEN JE VERDER
              </p>

              <h1 className="mt-4 font-display text-6xl leading-[0.9] sm:text-8xl">
                CONTACT.
              </h1>

              <p className="mt-6 max-w-md text-lg leading-relaxed text-[#D7D9DA]">
                Heb je een vraag? Stuur ons een bericht.
                We reageren via het e-mailadres dat je invult.
              </p>

              <div
                aria-hidden="true"
                className="mt-8 h-1 w-20 bg-[#D6FF3F]"
              />
            </div>

            <div className="w-full min-w-0">
              <SupportForm />

              <p className="mt-6 max-w-2xl text-sm leading-relaxed text-[#B9BEC2]">
                <i>Ook voor vragen over je account of een verzoek tot
                accountverwijdering kun je dit formulier gebruiken.
                Je hoeft hiervoor niet ingelogd te zijn.</i>
              </p>
            </div>
          </div>
        </div>
      </main>

      <SiteFooter showAppBadges={false} />
    </div>
  );
}