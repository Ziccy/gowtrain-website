"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import SiteFooter from "@/components/SiteFooter";
import { supabase } from "@/lib/supabase-browser";

type PageMode = "login" | "forgot-password";
type TrainerLoginResult = "trainer" | "admin" | false;

export default function TrainerLoginPage() {
  const [mode, setMode] = useState<PageMode>("login");

  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [showPassword, setShowPassword] = useState<boolean>(false);

  const [checkingSession, setCheckingSession] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);

  const [errorMessage, setErrorMessage] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");

  useEffect(() => {
    checkExistingSession();
  }, []);

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

    const result = await getOrRepairTrainerRole(user.id);

    if (result === "trainer") {
      window.location.assign("/trainer-dashboard");
      return;
    }

    if (result === "admin") {
      window.location.assign("/admin");
      return;
    }

    setCheckingSession(false);
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

  async function getOrRepairTrainerRole(
    userId: string
  ): Promise<TrainerLoginResult> {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();

    if (profileError) {
      console.error("Profielcontrole fout:", profileError.message);
      showError("Je profiel kon niet worden gecontroleerd.");
      return false;
    }

    if (profile?.role === "admin") {
      return "admin";
    }

    if (profile?.role === "trainer") {
      return "trainer";
    }

    if (profile?.role === "player") {
      await supabase.auth.signOut();
      showError(
        "Dit is een speleraccount. Log in via de GowTrain app of gebruik een traineraccount."
      );
      return false;
    }

    const { data: trainer, error: trainerError } = await supabase
      .from("trainers")
      .select("id, name")
      .eq("user_id", userId)
      .maybeSingle();

    if (trainerError) {
      console.error("Trainercontrole fout:", trainerError.message);
      showError("Je traineraccount kon niet worden gecontroleerd.");
      return false;
    }

    if (trainer) {
      const { error: repairError } = await supabase.from("profiles").upsert({
        id: userId,
        role: "trainer",
        full_name: trainer.name,
      });

      if (repairError) {
        console.error("Profielherstel fout:", repairError.message);
        showError(
          "Je traineraccount is gevonden, maar je profiel kon niet worden hersteld."
        );
        return false;
      }

      return "trainer";
    }

    await supabase.auth.signOut();
    showError(
      "Er is geen trainerprofiel gekoppeld aan dit account. Maak eerst een traineraccount aan."
    );

    return false;
  }

  async function handleLogin(): Promise<void> {
    clearMessages();

    if (!validateEmail()) return;

    if (!password.trim()) {
      showError("Vul je wachtwoord in.");
      return;
    }

    setLoading(true);

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (error) {
      console.error("Trainer login fout:", error.message);
      setLoading(false);
      showError("Inloggen mislukt. Controleer je e-mailadres en wachtwoord.");
      return;
    }

    const userId = data.user?.id;

    if (!userId) {
      setLoading(false);
      showError("Je account kon niet worden gevonden. Probeer het opnieuw.");
      return;
    }

    const result = await getOrRepairTrainerRole(userId);

    setLoading(false);

    if (!result) return;

    if (result === "admin") {
      window.location.assign("/admin");
      return;
    }

    window.location.assign("/trainer-dashboard");
  }

  async function handleForgotPassword(): Promise<void> {
    clearMessages();

    if (!validateEmail()) return;

    setLoading(true);

    const redirectTo =
      typeof window !== "undefined"
        ? `${window.location.origin}/trainer-reset-wachtwoord`
        : undefined;

    const { error } = await supabase.auth.resetPasswordForEmail(
      email.trim().toLowerCase(),
      { redirectTo }
    );

    setLoading(false);

    if (error) {
      console.error("Wachtwoordherstel fout:", error.message);
      showError(
        "De resetlink kon niet worden verstuurd. Probeer het later opnieuw."
      );
      return;
    }

    setSuccessMessage(
      "Check je e-mail! We hebben je een link gestuurd om je wachtwoord te herstellen."
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
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

  /* VERBETERD LAADSCHERM MET GOW!-BRANDING */
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

  const body = isForgotPassword
    ? "Vul je e-mailadres in. We sturen je een link om je wachtwoord direct te herstellen."
    : "Beheer je beschikbaarheid, bekijk geboekte trainingen en houd je trainerprofiel up-to-date.";

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      {/* HEADER */}
      <header className="border-b border-white/15">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
          <a
            href="/"
            aria-label="GowTrain home"
            className="group inline-flex items-center gap-2"
          >
            <span className="font-display text-3xl leading-none text-[#D6FF3F] sm:text-4xl">
              GOWTRAIN
            </span>
            <span className="mt-1 h-0 w-0 border-b-[9px] border-l-[8px] border-t-[9px] border-b-transparent border-l-[#D6FF3F] border-t-transparent transition-transform duration-200 group-hover:translate-x-1 sm:border-b-[11px] sm:border-l-[9px] sm:border-t-[11px]" />
          </a>

          <a
            href="/trainer-worden"
            className="hidden font-display text-base text-white transition hover:text-[#D6FF3F] sm:block"
          >
            NOG GEEN ACCOUNT? WORD TRAINER →
          </a>
        </div>
      </header>

      <section className="relative flex flex-1 items-center overflow-hidden py-16 sm:py-20">
        {/* Achtergronddecoratie */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 top-1/2 -translate-y-1/2 select-none font-display text-[18rem] leading-none text-[#D6FF3F] opacity-[0.05] sm:text-[28rem] lg:text-[38rem]"
        >
          GOW
        </div>

        <div className="relative mx-auto grid w-full max-w-7xl gap-12 px-5 sm:px-8 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20">
          
          {/* LINKERKOLOM */}
          <div className="lg:self-center">
            <p className="font-display text-lg text-[#FF4B3E]">
              TRAINER PORTAL
            </p>

            <h1 className="mt-4 max-w-3xl font-display text-6xl leading-[0.83] sm:text-7xl lg:text-8xl">
              {isForgotPassword ? (
                <>
                  NIEUW<br />
                  WACHTWOORD.<br />
                  GOW!
                </>
              ) : (
                <>
                  LOG IN.<br />
                  RUN JE<br />
                  TRAINING.
                </>
              )}
            </h1>

            <p className="mt-8 max-w-md text-lg leading-relaxed text-[#D7D9DA] sm:text-xl">
              {body}
            </p>

            {!isForgotPassword && (
              <div className="mt-10 border-l-2 border-[#D6FF3F] pl-5">
                <p className="font-display text-2xl text-[#D6FF3F]">
                  JOUW AGENDA. JOUW BAAN.
                </p>
                <p className="mt-2 max-w-sm leading-relaxed text-[#B9BEC2]">
                  Stel je beschikbare tijden in, accepteer boekingen en sta zonder administratie-stress op de baan.
                </p>
              </div>
            )}

            <div className="mt-10 hidden border-t border-white/20 pt-6 lg:block">
              <p className="font-display text-lg text-white">
                NOG GEEN TRAINERACCOUNT?
              </p>
              <p className="mt-2 text-sm leading-relaxed text-[#B9BEC2]">
                Meld je gratis aan, stel je uurtarief in en word vindbaar voor spelers in jouw regio.
              </p>
              <a
                href="/trainer-worden"
                className="mt-4 inline-flex font-display text-base text-[#D6FF3F] transition hover:text-white"
              >
                WORD TRAINER. GOW! →
              </a>
            </div>
          </div>

          {/* LOGIN-KAART */}
          <div className="mx-auto w-full max-w-xl border-2 border-white bg-white p-3 text-[#14171A] shadow-[10px_10px_0_0_#FF4B3E] sm:p-4">
            <div className="bg-[#14171A] p-5 sm:p-8">
              <div className="border-b border-white/20 pb-6">
                <p className="font-display text-xl text-[#D6FF3F]">
                  {isForgotPassword ? "HERSTEL JE TOEGANG." : "WELKOM TERUG."}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-[#B9BEC2]">
                  {isForgotPassword
                    ? "Vul je e-mailadres in om een resetlink te ontvangen."
                    : "Log in met je GowTrain traineraccount."}
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
                  {/* Email */}
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
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      autoCapitalize="none"
                      placeholder="jij@voorbeeld.nl"
                      className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none transition placeholder:text-[#8A8F94] focus:border-[#D6FF3F]"
                    />
                  </div>

                  {/* Password + Show Toggle */}
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
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="current-password"
                        placeholder="Je wachtwoord"
                        className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none transition placeholder:text-[#8A8F94] focus:border-[#D6FF3F]"
                      />
                    </div>
                  )}
                </div>

                {/* Switch Modes */}
                {!isForgotPassword ? (
                  <div className="mt-4 flex justify-between text-sm">
                    <button
                      type="button"
                      onClick={() => switchMode("forgot-password")}
                      className="font-display text-sm text-[#D6FF3F] transition hover:text-white"
                    >
                      WACHTWOORD VERGETEN?
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => switchMode("login")}
                    className="mt-4 font-display text-sm text-[#D6FF3F] transition hover:text-white"
                  >
                    ← TERUG NAAR INLOGGEN
                  </button>
                )}

                {/* Submit button */}
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
                    Nog geen traineraccount bij GowTrain?
                  </p>
                  <a
                    href="/trainer-worden"
                    className="mt-3 inline-flex font-display text-lg text-[#D6FF3F] transition hover:text-white"
                  >
                    WORD TRAINER. GOW! →
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