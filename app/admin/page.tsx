"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SiteFooter from "@/components/SiteFooter";
import { supabase } from "@/lib/supabase-browser";

export default function AdminHubPage() {
  const router = useRouter();

  const [adminName, setAdminName] = useState<string>("");
  const [pendingTrainersCount, setPendingTrainersCount] = useState<number>(0);
  const [openIssuesCount, setOpenIssuesCount] = useState<number>(0);

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
        router.replace("/trainer-login");
        return;
      }

      // 1. Controleer admin rol
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role, full_name")
        .eq("id", session.user.id)
        .maybeSingle();

      if (profileError || profile?.role !== "admin") {
        await supabase.auth.signOut();
        router.replace("/trainer-login");
        return;
      }

      setAdminName(profile.full_name || session.user.email?.split("@")[0] || "ADMIN");

      // 2. Wachtende trainers tellen
      const { count: pendingCount } = await supabase
        .from("trainers")
        .select("id", { count: "exact", head: true })
        .eq("approval_status", "pending");

      setPendingTrainersCount(pendingCount ?? 0);

      // 3. Openstaande issues tellen (tabel: booking_issues)
      const { count: issuesCount } = await supabase
        .from("booking_issues")
        .select("id", { count: "exact", head: true })
        .eq("status", "open");

      setOpenIssuesCount(issuesCount ?? 0);
    } catch (error) {
      console.error("Admin Hub laden fout:", error);
      setErrorMessage("Het admin overzicht kon niet worden geladen.");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout(): Promise<void> {
    await supabase.auth.signOut();
    router.replace("/trainer-login");
    router.refresh();
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
      {/* HEADER */}
      <header className="border-b border-white/15">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
          <Link
            href="/"
            aria-label="GowTrain home"
            className="group inline-flex items-center gap-2"
          >
            <span className="font-display text-3xl leading-none text-[#D6FF3F] sm:text-4xl">
              GOWTRAIN
            </span>
            <span className="mt-1 h-0 w-0 border-b-[9px] border-l-[8px] border-t-[9px] border-b-transparent border-l-[#D6FF3F] border-t-transparent transition-transform duration-200 group-hover:translate-x-1 sm:border-b-[11px] sm:border-l-[9px] sm:border-t-[11px]" />
          </Link>

          <div className="flex items-center gap-3">
            <span className="bg-[#FF4B3E] px-3 py-1 font-display text-xs text-white">
              ADMIN CONTROL
            </span>

            <button
              type="button"
              onClick={() => void handleLogout()}
              className="border-2 border-white px-4 py-2 font-display text-sm text-white transition hover:border-[#D6FF3F] hover:bg-[#D6FF3F] hover:text-[#14171A]"
            >
              UITLOGGEN
            </button>
          </div>
        </div>
      </header>

      {/* CONTENT */}
      <section className="relative flex-1 overflow-hidden py-12 sm:py-16">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 -top-20 select-none font-display text-[16rem] leading-none text-[#D6FF3F] opacity-[0.04] sm:text-[25rem]"
        >
          ADMIN
        </div>

        <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
          
          <div className="border-b-2 border-white/20 pb-8">
            <p className="font-display text-lg text-[#FF4B3E]">BEHEERSCENTRUM</p>
            <h1 className="mt-3 font-display text-5xl leading-[0.83] sm:text-6xl lg:text-7xl">
              WELKOM, {adminName.toUpperCase()}.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-[#D7D9DA]">
              Kies een onderdeel om het GowTrain platform te beheren.
            </p>
          </div>

          {errorMessage && (
            <div role="alert" className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] px-5 py-4 font-semibold text-white">
              {errorMessage}
            </div>
          )}

          {/* HOOFD NAVIGATIE KAARTEN */}
          <div className="mt-10 grid gap-8 md:grid-cols-2">
            
            {/* TRAINERS GOEDKEUREN */}
            <Link
              href="/admin/trainers"
              className="group border-2 border-white bg-white p-3 text-[#14171A] transition duration-200 hover:-translate-y-2 hover:shadow-[10px_10px_0_0_#D6FF3F]"
            >
              <div className="bg-[#14171A] p-6 text-white sm:p-8 flex flex-col justify-between h-full">
                <div>
                  <div className="flex items-center justify-between">
                    <p className="font-display text-xl text-[#D6FF3F]">01 / TRAINERS</p>
                    {pendingTrainersCount > 0 && (
                      <span className="bg-[#FF4B3E] px-3 py-1 font-display text-xs text-white animate-pulse">
                        {pendingTrainersCount} AANMELDINGEN
                      </span>
                    )}
                  </div>

                  <h2 className="mt-6 font-display text-4xl sm:text-5xl">
                    TRAINER<br />GOEDKEURING.
                  </h2>

                  <p className="mt-4 text-sm leading-relaxed text-[#B9BEC2]">
                    Beoordeel ingediende trainerprofielen, bekijk hun uurtarief &amp; specialisaties en keur ze goed of af.
                  </p>
                </div>

                <div className="mt-8 pt-4 border-t border-white/20 flex items-center justify-between">
                  <span className="font-display text-lg text-[#D6FF3F]">NAAR TRAINERS</span>
                  <span className="font-display text-2xl group-hover:translate-x-2 transition-transform">→</span>
                </div>
              </div>
            </Link>

            {/* ISSUES & PROBLEMEN */}
            <Link
              href="/admin/issues"
              className="group border-2 border-white bg-white p-3 text-[#14171A] transition duration-200 hover:-translate-y-2 hover:shadow-[10px_10px_0_0_#FF4B3E]"
            >
              <div className="bg-[#14171A] p-6 text-white sm:p-8 flex flex-col justify-between h-full">
                <div>
                  <div className="flex items-center justify-between">
                    <p className="font-display text-xl text-[#FF4B3E]">02 / MELDINGEN</p>
                    {openIssuesCount > 0 && (
                      <span className="bg-[#FF4B3E] px-3 py-1 font-display text-xs text-white">
                        {openIssuesCount} OPEN
                      </span>
                    )}
                  </div>

                  <h2 className="mt-6 font-display text-4xl sm:text-5xl">
                    ISSUES &amp;<br />PROBLEMEN.
                  </h2>

                  <p className="mt-4 text-sm leading-relaxed text-[#B9BEC2]">
                    Bekijk gemelde problemen van spelers of trainers rondom trainingen, locaties of betalingen.
                  </p>
                </div>

                <div className="mt-8 pt-4 border-t border-white/20 flex items-center justify-between">
                  <span className="font-display text-lg text-[#FF4B3E]">NAAR ISSUES</span>
                  <span className="font-display text-2xl group-hover:translate-x-2 transition-transform">→</span>
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