"use client";

import type { FormEvent } from "react";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import SiteFooter from "@/components/SiteFooter";
import { supabase } from "@/lib/supabase-browser";

type PageMode = "login" | "forgot-password";
type PlayerLoginResult = "player" | "trainer" | "admin" | false;

function getSafeRedirectTo(value: string | null): string | null {
  if (value?.startsWith("/boeken/")) {
    return value;
  }

  return null;
}

function SpelerLoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const safeRedirectTo = getSafeRedirectTo(
    searchParams.get("redirectTo")
  );

  const [mode, setMode] = useState<PageMode>("login");
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [showPassword, setShowPassword] = useState<boolean>(false);

  const [checkingSession, setCheckingSession] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);

  const [errorMessage, setErrorMessage] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");

  const registerHref = safeRedirectTo
    ? `/speler-worden?redirectTo=${encodeURIComponent(safeRedirectTo)}`
    : "/speler-worden";

  useEffect(() => {
    void checkExistingSession();
  }, []);

  function redirectAfterLogin(): void {
    router.replace(safeRedirectTo ?? "/mijn-boekingen");
    router.refresh();
  }

  function clearMessages(): void {
    setErrorMessage("");
    setSuccessMessage("");
  }

  function showError(message: string): void {
    setSuccessMessage("");
    setErrorMessage(message);
  }

  function validateEmail(): boolean {
    if (!email.trim()) {
      showError("Vul je e-mailadres in.");
      return false;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(email.trim())) {
      showError("Vul een geldig e-mailadres in.");
      return false;
    }

    return true;
  }

  async function getPlayerRole(
    userId: string
  ): Promise<PlayerLoginResult> {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();

    if (profileError) {
      console.error(
        "Spelerprofiel controleren fout:",
        profileError.message
      );

      showError("Je profiel kon niet worden gecontroleerd.");
      return false;
    }

    if (!profile) {
      await supabase.auth.signOut();

      showError(
        "Je account is gevonden, maar er is nog geen spelerprofiel gekoppeld. Bevestig eventueel eerst je e-mailadres."
      );

      return false;
    }

    if (profile.role === "player") {
      return "player";
    }

    if (profile.role === "trainer") {
      return "trainer";
    }

    if (profile.role === "admin") {
      return "admin";
    }

    await supabase.auth.signOut();

    showError(
      "Dit account heeft geen geldige spelerrol. Neem contact op met GowTrain als dit niet klopt."
    );

    return false;
  }

  async function checkExistingSession(): Promise<void> {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.user) {
      setCheckingSession(false);
      return;
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      await supabase.auth.signOut();
      setCheckingSession(false);
      return;
    }

    const result = await getPlayerRole(user.id);

    if (result === "player") {
      redirectAfterLogin();
      return;
    }

    if (result === "trainer") {
      await supabase.auth.signOut();

      setErrorMessage(
        "Dit is een traineraccount. Gebruik de trainerlogin om in te loggen."
      );
    }

    if (result === "admin") {
      await supabase.auth.signOut();

      setErrorMessage(
        "Dit is een beheerderaccount. De beheeromgeving is nog niet beschikbaar op het web."
      );
    }

    setCheckingSession(false);
  }

  async function handleLogin(): Promise<void> {
    clearMessages();

    if (!validateEmail()) {
      return;
    }

    if (!password.trim()) {
      showError("Vul je wachtwoord in.");
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (error) {
        console.error("Speler login fout:", error.message);

        showError(
          "Inloggen mislukt. Controleer je e-mailadres en wachtwoord."
        );

        return;
      }

      const userId = data.user?.id;

      if (!userId) {
        showError(
          "Je account kon niet worden gevonden. Probeer het opnieuw."
        );

        return;
      }

      const result = await getPlayerRole(userId);

      if (!result) {
        return;
      }

      if (result === "trainer") {
        await supabase.auth.signOut();

        showError(
          "Dit is een traineraccount. Gebruik de trainerlogin om in te loggen."
        );

        return;
      }

      if (result === "admin") {
        await supabase.auth.signOut();

        showError(
          "Dit is een beheerderaccount. De beheeromgeving is nog niet beschikbaar op het web."
        );

        return;
      }

      redirectAfterLogin();
    } catch (error) {
      console.error("Onverwachte speler-login fout:", error);

      showError("Inloggen lukt nu niet. Probeer het opnieuw.");
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword(): Promise<void> {
    clearMessages();

    if (!validateEmail()) {
      return;
    }

    setLoading(true);

    try {
      const redirectTo =
        typeof window !== "undefined"
          ? `${window.location.origin}/speler-reset-wachtwoord`
          : undefined;

      const { error } = await supabase.auth.resetPasswordForEmail(
        email.trim().toLowerCase(),
        {
          redirectTo,
        }
      );

      if (error) {
        console.error(
          "Speler wachtwoordherstel fout:",
          error.message
        );

        showError(
          "De resetlink kon niet worden verstuurd. Probeer het later opnieuw."
        );

        return;
      }

      setSuccessMessage(
        "Check je e-mail! We hebben je een link gestuurd om je wachtwoord te herstellen."
      );
    } catch (error) {
      console.error(
        "Onverwachte wachtwoordherstel fout:",
        error
      );

      showError(
        "De resetlink kon niet worden verstuurd. Probeer het later opnieuw."
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ): Promise<void> {
    event.preventDefault();

    if (mode === "forgot-password") {
      await handleForgotPassword();
      return;
    }

    await handleLogin();
  }

  function switchMode(nextMode: PageMode): void {
    clearMessages();
    setMode(nextMode);
    setPassword("");
  }

  if (checkingSession) {
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
            INLOGGEN CONTROLEREN...
          </p>
        </div>
      </main>
    );
  }

  const isForgotPassword = mode === "forgot-password";
  const cameFromBooking = Boolean(safeRedirectTo);

  const body = isForgotPassword
    ? "Vul je e-mailadres in. We sturen je een link om je wachtwoord opnieuw in te stellen."
    : cameFromBooking
      ? "Log in met je speleraccount om direct jouw gekozen training te bevestigen."
      : "Bekijk je geplande trainingen, vind je favoriete trainers terug en boeken maar.";

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
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
            href={registerHref}
            className="hidden font-display text-base text-white transition hover:text-[#D6FF3F] sm:block"
          >
            NOG GEEN ACCOUNT? WORD SPELER →
          </a>
        </div>
      </header>

      <section className="relative flex flex-1 items-center overflow-hidden py-16 sm:py-20">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 top-1/2 -translate-y-1/2 select-none font-display text-[18rem] leading-none text-[#D6FF3F] opacity-[0.05] sm:text-[28rem] lg:text-[38rem]"
        >
          GOW
        </div>

        <div className="relative mx-auto grid w-full max-w-7xl gap-12 px-5 sm:px-8 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20">
          <div className="lg:self-center">
            <p className="font-display text-lg text-[#FF4B3E]">
              SPELER PORTAL
            </p>

            <h1 className="mt-4 max-w-3xl font-display text-6xl leading-[0.83] sm:text-7xl lg:text-8xl">
              {isForgotPassword ? (
                <>
                  NIEUW
                  <br />
                  WACHTWOORD.
                  <br />
                  GOW!
                </>
              ) : cameFromBooking ? (
                <>
                  LOG IN.
                  <br />
                  BOEK JE
                  <br />
                  MOMENT.
                </>
              ) : (
                <>
                  LOG IN.
                  <br />
                  GOW NAAR
                  <br />
                  DE BAAN.
                </>
              )}
            </h1>

            <p className="mt-8 max-w-md text-lg leading-relaxed text-[#D7D9DA] sm:text-xl">
              {body}
            </p>

            {cameFromBooking && !isForgotPassword ? (
              <div className="mt-8 border-2 border-[#D6FF3F] bg-[#14171A] p-4 shadow-[5px_5px_0_0_#D6FF3F]">
                <p className="font-display text-lg text-[#D6FF3F]">
                  ⚡ BIJNA KLAAR
                </p>

                <p className="mt-1 text-sm text-[#B9BEC2]">
                  Na het inloggen word je direct teruggestuurd om je training
                  af te ronden.
                </p>
              </div>
            ) : !isForgotPassword ? (
              <div className="mt-10 border-l-2 border-[#D6FF3F] pl-5">
                <p className="font-display text-2xl text-[#D6FF3F]">
                  JOUW TRAINING. JOUW MOMENT.
                </p>

                <p className="mt-2 max-w-sm leading-relaxed text-[#B9BEC2]">
                  Bekijk al je aanvragen en geplande trainingen direct op één
                  centrale plek.
                </p>
              </div>
            ) : null}

            <div className="mt-10 hidden border-t border-white/20 pt-6 lg:block">
              <p className="font-display text-lg text-white">
                NOG GEEN SPELERACCOUNT?
              </p>

              <p className="mt-2 text-sm leading-relaxed text-[#B9BEC2]">
                Maak binnen 1 minuut je speleraccount aan en boek direct je
                eerste les.
              </p>

              <a
                href={registerHref}
                className="mt-4 inline-flex font-display text-base text-[#D6FF3F] transition hover:text-white"
              >
                WORD SPELER. GOW! →
              </a>
            </div>
          </div>

          <div className="mx-auto w-full max-w-xl border-2 border-white bg-white p-3 text-[#14171A] shadow-[10px_10px_0_0_#FF4B3E] sm:p-4">
            <div className="bg-[#14171A] p-5 sm:p-8">
              <div className="border-b border-white/20 pb-6">
                <p className="font-display text-xl text-[#D6FF3F]">
                  {isForgotPassword
                    ? "HERSTEL JE TOEGANG."
                    : "WELKOM TERUG."}
                </p>

                <p className="mt-2 text-sm leading-relaxed text-[#B9BEC2]">
                  {isForgotPassword
                    ? "Vul je e-mailadres in om een resetlink te ontvangen."
                    : cameFromBooking
                      ? "Log in om verder te gaan met jouw boeking."
                      : "Log in met je speleraccount."}
                </p>
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
                  className="mt-6 border-2 border-[#D6FF3F] bg-[#D6FF3F] px-4 py-3 text-sm font-semibold leading-relaxed text-[#14171A]"
                >
                  {successMessage}
                </div>
              )}

              <form onSubmit={handleSubmit} className="mt-7">
                <div className="space-y-5">
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
                      onChange={(event) => setEmail(event.target.value)}
                      autoComplete="email"
                      autoCapitalize="none"
                      placeholder="jij@voorbeeld.nl"
                      className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none transition placeholder:text-[#8A8F94] focus:border-[#D6FF3F]"
                    />
                  </div>

                  {!isForgotPassword && (
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
                          onClick={() =>
                            setShowPassword((current) => !current)
                          }
                          className="text-xs text-[#8A8F94] hover:text-[#D6FF3F]"
                        >
                          {showPassword ? "VERBERGEN" : "TONEN"}
                        </button>
                      </div>

                      <input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(event) =>
                          setPassword(event.target.value)
                        }
                        autoComplete="current-password"
                        placeholder="Je wachtwoord"
                        className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none transition placeholder:text-[#8A8F94] focus:border-[#D6FF3F]"
                      />
                    </div>
                  )}
                </div>

                {!isForgotPassword ? (
                  <button
                    type="button"
                    onClick={() => switchMode("forgot-password")}
                    className="mt-4 font-display text-sm text-[#D6FF3F] transition hover:text-white"
                  >
                    WACHTWOORD VERGETEN?
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => switchMode("login")}
                    className="mt-4 font-display text-sm text-[#D6FF3F] transition hover:text-white"
                  >
                    ← TERUG NAAR INLOGGEN
                  </button>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="mt-8 flex w-full items-center justify-center gap-3 bg-[#FF4B3E] px-6 py-5 font-display text-xl text-white transition hover:-translate-y-1 hover:bg-[#D6FF3F] hover:text-[#14171A] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
                >
                  {loading
                    ? isForgotPassword
                      ? "LINK VERSTUREN..."
                      : "INLOGGEN..."
                    : isForgotPassword
                      ? "STUUR RESETLINK"
                      : "LOGIN. GOW!"}

                  {!loading && <span aria-hidden="true">→</span>}
                </button>
              </form>

              {!isForgotPassword && (
                <div className="mt-8 border-t border-white/20 pt-6 text-center">
                  <p className="text-sm text-[#B9BEC2]">
                    Nog geen speleraccount?
                  </p>

                  <a
                    href={registerHref}
                    className="mt-3 inline-flex font-display text-lg text-[#D6FF3F] transition hover:text-white"
                  >
                    WORD SPELER. GOW! →
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}

function SpelerLoginFallback() {
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
          PAGINA LADEN...
        </p>
      </div>
    </main>
  );
}

export default function SpelerLoginPage() {
  return (
    <Suspense fallback={<SpelerLoginFallback />}>
      <SpelerLoginContent />
    </Suspense>
  );
}