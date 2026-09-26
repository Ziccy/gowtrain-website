"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { supabase } from "@/lib/supabase-browser";

export default function AdminHubPage() {
  const router = useRouter();

  const [adminName, setAdminName] = useState<string>("");
  const [pendingTrainersCount, setPendingTrainersCount] = useState<number>(0);
  const [openIssuesCount, setOpenIssuesCount] = useState<number>(0);
  const [activeVenuesCount, setActiveVenuesCount] = useState<number>(0);
  const [totalReviewsCount, setTotalReviewsCount] = useState<number>(0);

  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    void verifyAdminAndLoadStats();
  }, []);

  async function verifyAdminAndLoadStats(): Promise<void> {
    setLoading(true);
    setErrorMessage("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        router.replace("/speler-login");
        return;
      }

      // 1. Controleer adminrol.
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role, full_name")
        .eq("id", session.user.id)
        .maybeSingle();

      if (profileError || profile?.role !== "admin") {
        await supabase.auth.signOut();
        router.replace("/speler-login");
        return;
      }

      setAdminName(
        profile.full_name ||
          session.user.email?.split("@")[0] ||
          "ADMIN"
      );

      // 2. Wachtende trainers tellen.
      const { count: pendingCount } = await supabase
        .from("trainers")
        .select("id", { count: "exact", head: true })
        .eq("approval_status", "pending");

      setPendingTrainersCount(pendingCount ?? 0);

      // 3. Openstaande issues tellen.
      const { count: issuesCount } = await supabase
        .from("booking_issues")
        .select("id", { count: "exact", head: true })
        .eq("status", "open");

      setOpenIssuesCount(issuesCount ?? 0);

      // 4. Actieve locaties tellen.
      const { count: venuesCount } = await supabase
        .from("venues")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true);

      setActiveVenuesCount(venuesCount ?? 0);

      // 5. Totaal aantal reviews tellen.
      const { count: reviewsCount } = await supabase
        .from("trainer_reviews")
        .select("id", { count: "exact", head: true });

      setTotalReviewsCount(reviewsCount ?? 0);
    } catch {
      setErrorMessage("Het admin overzicht kon niet worden geladen.");
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-[#14171A] px-5 text-white">
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-2">
            <span className="font-display text-5xl text-[#D6FF3F] sm:text-6xl">
              GOWTRAIN
            </span>
            <span className="h-0 w-0 animate-pulse border-b-[14px] border-l-[12px] border-t-[14px] border-b-transparent border-l-[#D6FF3F] border-t-transparent" />
          </div>

          <p className="mt-4 font-display text-sm tracking-widest text-[#FF4B3E]">
            ADMIN HUB LADEN...
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      <SiteHeader />

      <section className="relative flex-1 overflow-hidden py-10 sm:py-14">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 -top-20 select-none font-display text-[16rem] leading-none text-[#D6FF3F] opacity-[0.04] sm:text-[25rem]"
        >
          ADMIN
        </div>

        <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
          <div className="flex flex-col justify-between gap-4 border-b-2 border-white/20 pb-8 sm:flex-row sm:items-end">
            <div>
              <p className="font-display text-lg text-[#FF4B3E]">
                BEHEERSCENTRUM
              </p>

              <h1 className="mt-2 font-display text-5xl leading-[0.83] sm:text-6xl lg:text-7xl">
                WELKOM, {adminName.toUpperCase()}.
              </h1>

              <p className="mt-4 max-w-2xl text-base leading-relaxed text-[#D7D9DA]">
                Kies een onderdeel om het GowTrain platform en de kwaliteit
                te beheren.
              </p>
            </div>

            <span className="shrink-0 bg-[#FF4B3E] px-3.5 py-1.5 font-display text-xs text-white">
              ADMIN CONTROL
            </span>
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] px-5 py-4 font-semibold text-white"
            >
              {errorMessage}
            </div>
          )}

          {/* HOOFDNAVIGATIE: VIJF KAARTEN, VANAF MD TWEE KOLOMMEN */}
          <div className="mt-10 grid gap-8 md:grid-cols-2">
            {/* 1. TRAINERS GOEDKEUREN */}
            <Link
              href="/admin/trainers"
              className="group border-2 border-white bg-white p-3 text-[#14171A] transition duration-200 hover:-translate-y-1 hover:shadow-[10px_10px_0_0_#D6FF3F]"
            >
              <div className="flex h-full flex-col justify-between bg-[#14171A] p-6 text-white sm:p-8">
                <div>
                  <div className="flex items-center justify-between">
                    <p className="font-display text-xl text-[#D6FF3F]">
                      01 / TRAINERS
                    </p>

                    {pendingTrainersCount > 0 ? (
                      <span className="animate-pulse bg-[#FF4B3E] px-3 py-1 font-display text-xs text-white">
                        {pendingTrainersCount} WACHTEND
                      </span>
                    ) : (
                      <span className="border border-white/30 px-3 py-1 font-display text-xs text-[#B9BEC2]">
                        BIJGEWERKT
                      </span>
                    )}
                  </div>

                  <h2 className="mt-6 font-display text-4xl sm:text-5xl">
                    TRAINER
                    <br />
                    GOEDKEURING.
                  </h2>

                  <p className="mt-4 text-sm leading-relaxed text-[#B9BEC2]">
                    Beoordeel ingediende trainerprofielen, bekijk hun
                    uurtarief &amp; specialisaties en keur ze goed of af.
                  </p>
                </div>

                <div className="mt-8 flex items-center justify-between border-t border-white/20 pt-4">
                  <span className="font-display text-lg text-[#D6FF3F]">
                    NAAR TRAINERS
                  </span>
                  <span className="font-display text-2xl transition-transform group-hover:translate-x-2">
                    →
                  </span>
                </div>
              </div>
            </Link>

            {/* 2. ISSUES & PROBLEMEN */}
            <Link
              href="/admin/issues"
              className="group border-2 border-white bg-white p-3 text-[#14171A] transition duration-200 hover:-translate-y-1 hover:shadow-[10px_10px_0_0_#FF4B3E]"
            >
              <div className="flex h-full flex-col justify-between bg-[#14171A] p-6 text-white sm:p-8">
                <div>
                  <div className="flex items-center justify-between">
                    <p className="font-display text-xl text-[#FF4B3E]">
                      02 / MELDINGEN
                    </p>

                    {openIssuesCount > 0 ? (
                      <span className="bg-[#FF4B3E] px-3 py-1 font-display text-xs text-white">
                        {openIssuesCount} OPEN
                      </span>
                    ) : (
                      <span className="border border-white/30 px-3 py-1 font-display text-xs text-[#B9BEC2]">
                        GEEN ISSUES
                      </span>
                    )}
                  </div>

                  <h2 className="mt-6 font-display text-4xl sm:text-5xl">
                    ISSUES &amp;
                    <br />
                    PROBLEMEN.
                  </h2>

                  <p className="mt-4 text-sm leading-relaxed text-[#B9BEC2]">
                    Bekijk gemelde problemen van spelers of trainers rondom
                    trainingen, locaties of betalingen.
                  </p>
                </div>

                <div className="mt-8 flex items-center justify-between border-t border-white/20 pt-4">
                  <span className="font-display text-lg text-[#FF4B3E]">
                    NAAR ISSUES
                  </span>
                  <span className="font-display text-2xl transition-transform group-hover:translate-x-2">
                    →
                  </span>
                </div>
              </div>
            </Link>

            {/* 3. CLUBS & LOCATIES */}
            <Link
              href="/admin/venues"
              className="group border-2 border-white bg-white p-3 text-[#14171A] transition duration-200 hover:-translate-y-1 hover:shadow-[10px_10px_0_0_#D6FF3F]"
            >
              <div className="flex h-full flex-col justify-between bg-[#14171A] p-6 text-white sm:p-8">
                <div>
                  <div className="flex items-center justify-between">
                    <p className="font-display text-xl text-[#D6FF3F]">
                      03 / LOCATIES
                    </p>
                    <span className="bg-[#D6FF3F] px-3 py-1 font-display text-xs text-[#14171A]">
                      {activeVenuesCount} ACTIEF
                    </span>
                  </div>

                  <h2 className="mt-6 font-display text-4xl sm:text-5xl">
                    LOCATIE
                    <br />
                    BEHEER.
                  </h2>

                  <p className="mt-4 text-sm leading-relaxed text-[#B9BEC2]">
                    Voeg verenigingen toe, wijzig adressen en beheer welke
                    padel- en tennisclubs actief zijn.
                  </p>
                </div>

                <div className="mt-8 flex items-center justify-between border-t border-white/20 pt-4">
                  <span className="font-display text-lg text-[#D6FF3F]">
                    NAAR LOCATIES
                  </span>
                  <span className="font-display text-2xl transition-transform group-hover:translate-x-2">
                    →
                  </span>
                </div>
              </div>
            </Link>

            {/* 4. REVIEWS & BEOORDELINGEN */}
            <Link
              href="/admin/reviews"
              className="group border-2 border-white bg-white p-3 text-[#14171A] transition duration-200 hover:-translate-y-1 hover:shadow-[10px_10px_0_0_#FF4B3E]"
            >
              <div className="flex h-full flex-col justify-between bg-[#14171A] p-6 text-white sm:p-8">
                <div>
                  <div className="flex items-center justify-between">
                    <p className="font-display text-xl text-[#FF4B3E]">
                      04 / REVIEWS
                    </p>
                    <span className="border border-white/30 px-3 py-1 font-display text-xs text-[#B9BEC2]">
                      {totalReviewsCount} REVIEWS
                    </span>
                  </div>

                  <h2 className="mt-6 font-display text-4xl sm:text-5xl">
                    SPELER
                    <br />
                    REVIEWS.
                  </h2>

                  <p className="mt-4 text-sm leading-relaxed text-[#B9BEC2]">
                    Beheer geschreven beoordelingen, controleer de kwaliteit
                    en verwijder eventuele ongewenste reviews.
                  </p>
                </div>

                <div className="mt-8 flex items-center justify-between border-t border-white/20 pt-4">
                  <span className="font-display text-lg text-[#FF4B3E]">
                    NAAR REVIEWS
                  </span>
                  <span className="font-display text-2xl transition-transform group-hover:translate-x-2">
                    →
                  </span>
                </div>
              </div>
            </Link>

            {/* 5. REFUNDADMINISTRATIE */}
            <Link
              href="/admin/refunds"
              className="group border-2 border-white bg-white p-3 text-[#14171A] transition duration-200 hover:-translate-y-1 hover:shadow-[10px_10px_0_0_#D6FF3F]"
            >
              <div className="flex h-full flex-col justify-between bg-[#14171A] p-6 text-white sm:p-8">
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="font-display text-xl text-[#D6FF3F]">
                      05 / REFUNDS
                    </p>
                    <span className="border border-white/30 px-3 py-1 font-display text-xs text-[#B9BEC2]">
                      SANDBOX · ALLEEN LEZEN
                    </span>
                  </div>

                  <h2 className="mt-6 font-display text-4xl sm:text-5xl">
                    REFUND
                    <br />
                    CONTROLE.
                  </h2>

                  <p className="mt-4 text-sm leading-relaxed text-[#B9BEC2]">
                    Bekijk refunduitzonderingen, gekoppelde lesbedragen en
                    administratieve afronding. Geen nieuwe terugbetalingen
                    of financiële statuswijzigingen.
                  </p>
                </div>

                <div className="mt-8 flex items-center justify-between border-t border-white/20 pt-4">
                  <span className="font-display text-lg text-[#D6FF3F]">
                    NAAR REFUNDS
                  </span>
                  <span className="font-display text-2xl transition-transform group-hover:translate-x-2">
                    →
                  </span>
                </div>
              </div>
            </Link>

            {/* 6. ACCOUNTVERWIJDERINGEN */}
<Link
  href="/admin/account-deletions"
  className="group border-2 border-white bg-white p-3 text-[#14171A] transition duration-200 hover:-translate-y-1 hover:shadow-[10px_10px_0_0_#FF4B3E]"
>
  <div className="flex h-full flex-col justify-between bg-[#14171A] p-6 text-white sm:p-8">
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-display text-xl text-[#FF4B3E]">
          06 / ACCOUNTS
        </p>

        <span className="border border-white/30 px-3 py-1 font-display text-xs text-[#B9BEC2]">
          INSPECTIE & OPVOLGING
        </span>
      </div>

      <h2 className="mt-6 break-words font-display text-4xl sm:text-5xl">
        ACCOUNT
        <br />
        VERWIJDERINGEN.
      </h2>

      <p className="mt-4 text-sm leading-relaxed text-[#B9BEC2]">
        Bekijk verwijderverzoeken, uitvoerfasen en externe afhandeltaken.
Wijs opvolging aan jezelf toe en plan een hercontrole. Geen
geforceerde verwijdering of automatische herstart.
      </p>
    </div>

    <div className="mt-8 flex items-center justify-between border-t border-white/20 pt-4">
      <span className="font-display text-lg text-[#FF4B3E]">
        BEKIJK VERZOEKEN
      </span>

      <span className="font-display text-2xl transition-transform group-hover:translate-x-2">
        →
      </span>
    </div>
  </div>
</Link>

          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}