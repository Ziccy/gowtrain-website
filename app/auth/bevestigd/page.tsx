"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { supabase } from "@/lib/supabase-browser";

type Status = "loading" | "success" | "error" | "no-session";

const content: Record<Status, { title: string; description: string }> = {
  loading: {
    title: "EVEN CONTROLEREN.",
    description: "We controleren je e-mailbevestiging.",
  },
  success: {
    title: "E-MAIL BEVESTIGD. GOW!",
    description:
      "Je e-mailadres is bevestigd. Ga verder naar je speler- of traineromgeving.",
  },
  error: {
    title: "CONTROLE NIET GELUKT.",
    description:
      "We konden je bevestiging niet controleren. De link kan verlopen of ongeldig zijn, of er is een verbindingsprobleem. Probeer in te loggen als je je e-mailadres al hebt bevestigd.",
  },
  "no-session": {
    title: "GA VERDER MET INLOGGEN.",
    description:
      "We kunnen hier geen actieve sessie vinden. Je e-mailadres kan wel al bevestigd zijn. Probeer in te loggen om verder te gaan.",
  },
};

export default function EmailBevestigdPage() {
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    let cancelled = false;

    function updateStatus(nextStatus: Status) {
      if (!cancelled) {
        setStatus(nextStatus);
      }
    }

    async function checkConfirmation() {
      try {
        const url = new URL(window.location.href);
        const hashParams = new URLSearchParams(url.hash.slice(1));

        const hasLinkError = [
          "error",
          "error_code",
          "error_description",
        ].some(
          (key) => url.searchParams.has(key) || hashParams.has(key)
        );

        if (hasLinkError) {
          updateStatus("error");
          return;
        }

        // Wacht op de automatische verwerking van de bevestigingslink.
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) {
          updateStatus("error");
          return;
        }

        if (!session) {
          updateStatus("no-session");
          return;
        }

        // Controleer het account bij Supabase, niet alleen lokaal.
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError || !user) {
          updateStatus("error");
          return;
        }

        updateStatus(user.email_confirmed_at ? "success" : "error");
      } catch {
        updateStatus("error");
      }
    }

    void checkConfirmation();

    return () => {
      cancelled = true;
    };
  }, []);

  const currentContent = content[status];

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      <SiteHeader />

      <section className="flex flex-1 items-center justify-center px-5 py-16">
        <div className="w-full max-w-xl border-2 border-white bg-[#14171A] p-7 shadow-[8px_8px_0_0_#FF4B3E] sm:p-10">
          <p className="font-display text-lg text-[#FF4B3E]">
            JOUW GOWTRAIN-ACCOUNT
          </p>

          <div
            role={status === "error" ? "alert" : "status"}
            aria-live="polite"
          >
            <h1 className="mt-4 font-display text-4xl leading-tight text-[#D6FF3F] sm:text-5xl">
              {currentContent.title}
            </h1>

            <p className="mt-6 text-base leading-relaxed text-[#D7D9DA]">
              {currentContent.description}
            </p>
          </div>

          {status !== "loading" && (
            <div className="mt-8 space-y-4">
              <Link
                href="/speler-login"
                className="block bg-[#D6FF3F] px-5 py-4 text-center font-display text-lg !text-[#14171A] transition hover:bg-white"
              >
                VERDER ALS SPELER →
              </Link>

              <Link
                href="/trainer-login"
                className="block border-2 border-white px-5 py-4 text-center font-display text-lg text-white transition hover:border-[#D6FF3F] hover:text-[#D6FF3F]"
              >
                VERDER ALS TRAINER →
              </Link>

              <Link
                href="/"
                className="block pt-2 text-center text-sm text-[#B9BEC2] underline underline-offset-4"
              >
                Terug naar de homepage
              </Link>
            </div>
          )}
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}