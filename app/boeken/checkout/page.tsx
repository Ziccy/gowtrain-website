"use client";

import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback, Suspense } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from "@stripe/react-stripe-js";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { supabase } from "@/lib/supabase-browser";

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || ""
);

function EmbeddedCheckoutContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const bookingId = searchParams.get("bookingId");
  const packageId = searchParams.get("packageId");

  const [errorMessage, setErrorMessage] = useState<string>("");

  const fetchClientSecret = useCallback(async () => {
    setErrorMessage("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        router.replace("/speler-login");
        return "";
      }

      const res = await fetch("/api/stripe/checkout/embedded", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ bookingId, packageId }),
      });

      const data = await res.json();
      if (!res.ok || !data.clientSecret) {
        setErrorMessage(data.error || "Betaalsessie kon niet gestart worden.");
        return "";
      }

      return data.clientSecret;
    } catch {
      setErrorMessage("Betaalsessie kon niet worden geladen.");
      return "";
    }
  }, [bookingId, packageId, router]);

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      {/* 💡 UNIVERSELE DYNAMISCHE SITE HEADER */}
      <SiteHeader />

      {/* CONTENT */}
      <section className="relative flex-1 overflow-hidden py-10 sm:py-14">
        <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
          
          <div className="flex flex-col justify-between gap-4 border-b-2 border-white/20 pb-6 mb-8 sm:flex-row sm:items-end">
            <div>
              <p className="font-display text-lg text-[#FF4B3E]">VEILIG AFREKENEN</p>
              <h1 className="mt-2 font-display text-5xl sm:text-6xl lg:text-7xl">
                ROND JE BETALING AF. GOW!
              </h1>
            </div>

            <Link
              href="/mijn-boekingen"
              className="inline-flex shrink-0 border-2 border-white px-4 py-2.5 font-display text-xs text-white hover:border-[#D6FF3F] hover:text-[#D6FF3F] transition"
            >
              ← MIJN BOEKINGEN
            </Link>
          </div>

          {errorMessage && (
            <div role="alert" className="mb-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] px-5 py-4 font-semibold text-white">
              {errorMessage}
            </div>
          )}

          {/* EMBEDDED STRIPE CHECKOUT CONTAINER */}
          <div className="border-2 border-white bg-white p-3 text-[#14171A] shadow-[10px_10px_0_0_#D6FF3F]">
            <div className="bg-[#14171A] p-4 sm:p-6 text-white min-h-[500px]">
              <EmbeddedCheckoutProvider
                stripe={stripePromise}
                options={{ fetchClientSecret }}
              >
                <EmbeddedCheckout className="gowtrain-stripe-embedded" />
              </EmbeddedCheckoutProvider>
            </div>
          </div>

        </div>
      </section>

      <SiteFooter />
    </main>
  );
}

function CheckoutFallback() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#14171A] px-5 text-white">
      <div className="flex flex-col items-center">
        <div className="flex items-center gap-2">
          <span className="font-display text-5xl text-[#D6FF3F]">GOWTRAIN</span>
          <span className="h-0 w-0 animate-pulse border-b-[14px] border-l-[12px] border-t-[14px] border-b-transparent border-l-[#D6FF3F] border-t-transparent" />
        </div>
        <p className="mt-4 font-display text-sm tracking-widest text-[#FF4B3E]">BETAALSCHERM OPENEN...</p>
      </div>
    </main>
  );
}

export default function EmbeddedCheckoutPage() {
  return (
    <Suspense fallback={<CheckoutFallback />}>
      <EmbeddedCheckoutContent />
    </Suspense>
  );
}