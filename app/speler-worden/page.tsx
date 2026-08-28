"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import SiteFooter from "@/components/SiteFooter";
import { supabase } from "@/lib/supabase-browser";

function getSafeRedirectTo(value: string | null): string | null {
  if (value?.startsWith("/boeken/")) {
    return value;
  }
  return null;
}

export default function SpelerWordenPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const safeRedirectTo = getSafeRedirectTo(searchParams.get("redirectTo"));

  const [name, setName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [confirmPassword, setConfirmPassword] = useState<string>("");
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [privacyAccepted, setPrivacyAccepted] = useState<boolean>(false);

  const [loading, setLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");

  const loginHref = safeRedirectTo
    ? `/speler-login?redirectTo=${encodeURIComponent(safeRedirectTo)}`
    : "/speler-login";

  function clearMessages(): void {
    setErrorMessage("");
    setSuccessMessage("");
  }

  function showError(message: string): void {
    setSuccessMessage("");
    setErrorMessage(message);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    clearMessages();

    if (!name.trim()) {
      showError("Vul je naam in.");
      return;
    }

    if (!email.trim()) {
      showError("Vul je e-mailadres in.");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(email.trim())) {
      showError("Vul een geldig e-mailadres in.");
      return;
    }

    if (!password.trim()) {
      showError("Kies een wachtwoord.");
      return;
    }

    if (password.length < 6) {
      showError("Je wachtwoord moet minimaal 6 tekens bevatten.");
      return;
    }

    if (!confirmPassword.trim()) {
      showError("Herhaal je wachtwoord.");
      return;
    }

    if (password !== confirmPassword) {
      showError("De wachtwoorden komen niet overeen.");
      return;
    }

    if (!privacyAccepted) {
      showError("Ga akkoord met de privacyverklaring om je speleraccount aan te maken.");
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: {
            role: "player",
            full_name: name.trim(),
          },
        },
      });

      if (error) {
        console.error("Spelerregistratie fout:", error.message);

        if (error.message.toLowerCase().includes("already registered")) {
          showError("Er bestaat al een account met dit e-mailadres. Log in met je speleraccount.");
          return;
        }

        showError("Je account kon niet worden aangemaakt. Probeer het opnieuw.");
        return;
      }

      if (!data.session) {
        setSuccessMessage(
          "Je account is aangemaakt! Check je e-mail en bevestig je e-mailadres. Daarna kun je inloggen en direct je training boeken."
        );

        setPassword("");
        setConfirmPassword("");
        return;
      }

      router.replace(safeRedirectTo ?? "/mijn-boekingen");
      router.refresh();
    } catch (error) {
      console.error("Onverwachte spelerregistratie-fout:", error);
      showError("Je account kon niet worden aangemaakt. Probeer het opnieuw.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      {/* HEADER */}
      <header className="border-b border-white/15">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
          <a
            href="/"
            aria-label="Terug naar GowTrain home"
            className="group inline-flex items-center gap-2"
          >
            <span className="font-display text-3xl leading-none text-[#D6FF3F] sm:text-4xl">
              GOWTRAIN
            </span>
            <span
              aria-hidden="true"
              className="mt-1 h-0 w-0 border-b-[9px] border-l-[8px] border-t-[9px] border-b-transparent border-l-[#D6FF3F] border-t-transparent transition-transform duration-200 group-hover:translate-x-1 sm:border-b-[11px] sm:border-l-[9px] sm:border-t-[11px]"
            />
          </a>

          <a
            href={loginHref}
            className="hidden font-display text-base text-white transition hover:text-[#D6FF3F] sm:block"
          >
            AL EEN ACCOUNT? LOGIN →
          </a>
        </div>
      </header>

      {/* CONTENT */}
      <section className="relative flex flex-1 items-center overflow-hidden py-12 sm:py-16 lg:py-20">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-12 top-0 select-none font-display text-[15rem] leading-none text-[#D6FF3F] opacity-[0.05] sm:text-[23rem] lg:text-[32rem]"
        >
          GOW
        </div>

        <div className="relative mx-auto grid w-full max-w-7xl gap-12 px-5 sm:px-8 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20">
          
          {/* LINKERKOLOM */}
          <div className="space-y-8 lg:sticky lg:top-10 lg:self-start">
            <div>
              <p className="font-display text-lg text-[#FF4B3E]">SPELER ACCOUNT</p>
              <h1 className="mt-2 font-display text-6xl leading-[0.83] sm:text-7xl lg:text-8xl">
                ZOEKEN.<br />
                KIEZEN.<br />
                GOW!
              </h1>
              <p className="mt-6 text-lg leading-relaxed text-[#D7D9DA] sm:text-xl">
                Vind in een paar tikken de beste padel- en tennistrainers bij jou in de buurt.
              </p>
            </div>

            {/* CALLOUT VOOR DIRECTE BOEKING */}
            {safeRedirectTo ? (
              <div className="border-2 border-[#D6FF3F] bg-[#14171A] p-5 shadow-[6px_6px_0_0_#D6FF3F]">
                <p className="font-display text-xl text-[#D6FF3F]">⚡ BIJNA KLAAR OM TE BOEKEN!</p>
                <p className="mt-2 text-sm leading-relaxed text-[#D7D9DA]">
                  Maak binnen 30 seconden je speleraccount aan. Daarna ga je direct terug om je gekozen training te bevestigen.
                </p>
              </div>
            ) : (
              /* USPs VOOR SPELERS */
              <div className="space-y-4 border-t border-white/20 pt-6">
                <div className="flex items-start gap-3">
                  <span className="font-display text-xl text-[#D6FF3F]">✓</span>
                  <div>
                    <p className="font-display text-base text-white">DIRECT LES BOEKEN</p>
                    <p className="text-sm text-[#B9BEC2]">Geen heen-en-weer appen. Bekijk live beschikbaarheid en boek meteen.</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <span className="font-display text-xl text-[#D6FF3F]">✓</span>
                  <div>
                    <p className="font-display text-base text-white">VERGELIJK OP JOUW NIVEAU</p>
                    <p className="text-sm text-[#B9BEC2]">Kies op basis van ervaring, tactiek, techniek of beoordelingen van anderen.</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <span className="font-display text-xl text-[#D6FF3F]">✓</span>
                  <div>
                    <p className="font-display text-base text-white">AL JE BOEKINGEN BIJ ELKAAR</p>
                    <p className="text-sm text-[#B9BEC2]">Overzicht van al je geplande trainingen en directe communicatie met je trainer.</p>
                  </div>
                </div>
              </div>
            )}

            <div className="hidden border-t border-white/20 pt-6 lg:block">
              <p className="font-display text-lg text-white">AL EEN SPELERACCOUNT?</p>
              <p className="mt-2 text-sm leading-relaxed text-[#B9BEC2]">
                Log in om je geplande trainingen te bekijken of een nieuwe les aan te vragen.
              </p>
              <a
                href={loginHref}
                className="mt-4 inline-flex font-display text-base text-[#D6FF3F] transition hover:text-white"
              >
                LOGIN. GOW! →
              </a>
            </div>
          </div>

          {/* FORMULIER */}
          <div className="mx-auto w-full max-w-xl border-2 border-white bg-white p-3 text-[#14171A] shadow-[10px_10px_0_0_#FF4B3E] sm:p-4">
            <div className="bg-[#14171A] p-5 sm:p-8">
              <div className="flex items-start justify-between gap-5 border-b border-white/20 pb-6">
                <div>
                  <p className="font-display text-xl text-[#D6FF3F]">MAAK JE ACCOUNT.</p>
                  <p className="mt-2 text-sm leading-relaxed text-[#B9BEC2]">
                    Binnen 1 minuut klaar om je eerste training te boeken.
                  </p>
                </div>
                <span className="shrink-0 bg-[#FF4B3E] px-3 py-2 font-display text-sm text-white">
                  SPELER
                </span>
              </div>

              {errorMessage && (
                <div
                  role="alert"
                  className="mt-6 border-2 border-[#FF4B3E] bg-[#FF4B3E] px-4 py-3 text-sm font-semibold leading-relaxed text-white"
                >
                  {errorMessage}
                </div>
              )}

              {successMessage && (
                <div
                  role="status"
                  className="mt-6 border-2 border-[#D6FF3F] bg-[#D6FF3F] px-4 py-4 text-sm font-semibold leading-relaxed text-[#14171A]"
                >
                  <p>{successMessage}</p>
                  <a
                    href={loginHref}
                    className="mt-4 inline-flex font-display text-base underline underline-offset-4 transition hover:text-[#FF4B3E]"
                  >
                    GA NAAR LOGIN →
                  </a>
                </div>
              )}

              <form onSubmit={handleSubmit} className="mt-7 space-y-6">
                <div>
                  <label
                    htmlFor="name"
                    className="mb-2 block font-display text-base text-[#FF4B3E]"
                  >
                    JOUW NAAM
                  </label>
                  <input
                    id="name"
                    type="text"
                    value={name}
                    onChange={(event) => {
                      clearMessages();
                      setName(event.target.value);
                    }}
                    autoComplete="name"
                    autoCapitalize="words"
                    placeholder="Bijv. Sem Jansen"
                    className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none transition placeholder:text-[#8A8F94] focus:border-[#D6FF3F]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="email"
                    className="mb-2 block font-display text-base text-[#FF4B3E]"
                  >
                    E-MAILADRES
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(event) => {
                      clearMessages();
                      setEmail(event.target.value);
                    }}
                    autoComplete="email"
                    autoCapitalize="none"
                    placeholder="jij@voorbeeld.nl"
                    className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none transition placeholder:text-[#8A8F94] focus:border-[#D6FF3F]"
                  />
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label
                      htmlFor="password"
                      className="block font-display text-base text-[#FF4B3E]"
                    >
                      WACHTWOORD
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="text-xs text-[#8A8F94] hover:text-[#D6FF3F]"
                    >
                      {showPassword ? "VERBERGEN" : "TONEN"}
                    </button>
                  </div>
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => {
                      clearMessages();
                      setPassword(event.target.value);
                    }}
                    autoComplete="new-password"
                    placeholder="Minimaal 6 tekens"
                    className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none transition placeholder:text-[#8A8F94] focus:border-[#D6FF3F]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="confirm-password"
                    className="mb-2 block font-display text-base text-[#FF4B3E]"
                  >
                    HERHAAL WACHTWOORD
                  </label>
                  <input
                    id="confirm-password"
                    type={showPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(event) => {
                      clearMessages();
                      setConfirmPassword(event.target.value);
                    }}
                    autoComplete="new-password"
                    placeholder="Herhaal je wachtwoord"
                    className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none transition placeholder:text-[#8A8F94] focus:border-[#D6FF3F]"
                  />
                </div>

                <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-[#B9BEC2]">
                  <input
                    type="checkbox"
                    checked={privacyAccepted}
                    onChange={(event) => {
                      clearMessages();
                      setPrivacyAccepted(event.target.checked);
                    }}
                    className="mt-1 h-5 w-5 shrink-0 accent-[#D6FF3F]"
                  />
                  <span>
                    Ik ga akkoord met de{" "}
                    <a
                      href="/privacy"
                      className="font-semibold text-[#D6FF3F] underline underline-offset-4 transition hover:text-white"
                    >
                      privacyverklaring
                    </a>
                    .
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={loading}
                  className="flex w-full items-center justify-center gap-3 bg-[#FF4B3E] px-6 py-5 font-display text-xl text-white transition hover:-translate-y-1 hover:bg-[#D6FF3F] hover:text-[#14171A] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
                >
                  {loading ? "ACCOUNT MAKEN..." : "REGISTREER. GOW!"}
                  {!loading && <span aria-hidden="true">→</span>}
                </button>

                <p className="text-center text-xs leading-relaxed text-[#8A8F94]">
                  Na registratie sturen we een bevestigingsmail om je account te activeren.
                </p>
              </form>

              <div className="mt-8 border-t border-white/20 pt-6 text-center">
                <p className="text-sm text-[#B9BEC2]">Heb je al een speleraccount?</p>
                <a
                  href={loginHref}
                  className="mt-3 inline-flex font-display text-lg text-[#D6FF3F] transition hover:text-white"
                >
                  LOGIN. GOW! →
                </a>
              </div>
            </div>
          </div>

        </div>
      </section>

      <SiteFooter />
    </main>
  );
}