"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import SiteFooter from "@/components/SiteFooter";
import { supabase } from "@/lib/supabase-browser";

type AccountType = "trainer" | "player";

type ResetPasswordFormProps = {
  accountType: AccountType;
};

type RecoveryState = "checking" | "ready" | "invalid" | "success";

const accountContent = {
  trainer: {
    kicker: "TRAINER ACCOUNT",
    loginHref: "/trainer-login",
    registerHref: "/trainer-worden",
    registerLabel: "WORD TRAINER",
    loginLabel: "TRAINER LOGIN",
    invalidTitle: "LINK VERLOPEN?",
    invalidText:
      "Deze resetlink is niet meer geldig of is al gebruikt. Vraag een nieuwe resetlink aan via de trainerlogin.",
  },
  player: {
    kicker: "SPELER ACCOUNT",
    loginHref: "/speler-login",
    registerHref: "/speler-worden",
    registerLabel: "WORD SPELER",
    loginLabel: "SPELER LOGIN",
    invalidTitle: "LINK VERLOPEN?",
    invalidText:
      "Deze resetlink is niet meer geldig of is al gebruikt. Vraag een nieuwe resetlink aan via de spelerlogin.",
  },
} as const;

export default function ResetPasswordForm({
  accountType,
}: ResetPasswordFormProps) {
  const content = accountContent[accountType];

  const [recoveryState, setRecoveryState] =
    useState<RecoveryState>("checking");

  const [password, setPassword] = useState<string>("");
  const [confirmPassword, setConfirmPassword] = useState<string>("");

  const [loading, setLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    let active = true;

    async function checkRecoverySession(): Promise<void> {
      /*
        Supabase verwerkt de recovery-token uit de URL automatisch
        en maakt vervolgens tijdelijk een sessie aan.
      */
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!active) {
        return;
      }

      setRecoveryState(session?.user ? "ready" : "invalid");
    }

    void checkRecoverySession();

    /*
      Soms wordt de recovery-sessie pas na de eerste render verwerkt.
      Daarom luisteren we ook naar auth-statuswijzigingen.
    */
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) {
        return;
      }

      if (event === "PASSWORD_RECOVERY" && session?.user) {
        setRecoveryState("ready");
        return;
      }

      if (event === "SIGNED_IN" && session?.user) {
        setRecoveryState((currentState) =>
          currentState === "checking" ? "ready" : currentState
        );
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  function clearError(): void {
    setErrorMessage("");
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ): Promise<void> {
    event.preventDefault();
    clearError();

    if (!password.trim()) {
      setErrorMessage("Kies een nieuw wachtwoord.");
      return;
    }

    if (password.length < 6) {
      setErrorMessage("Je wachtwoord moet minimaal 6 tekens bevatten.");
      return;
    }

    if (!confirmPassword.trim()) {
      setErrorMessage("Herhaal je nieuwe wachtwoord.");
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage("De wachtwoorden komen niet overeen.");
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password,
      });

      if (error) {
        console.error("Wachtwoord wijzigen fout:", error.message);

        setErrorMessage(
          "Je wachtwoord kon niet worden gewijzigd. Vraag eventueel een nieuwe resetlink aan."
        );

        return;
      }

      /*
        Na een reset loggen we bewust uit.
        De gebruiker kan daarna met het nieuwe wachtwoord opnieuw inloggen.
      */
      await supabase.auth.signOut();

      setPassword("");
      setConfirmPassword("");
      setRecoveryState("success");
    } catch (error) {
      console.error("Onverwachte wachtwoord-reset fout:", error);

      setErrorMessage(
        "Je wachtwoord kon niet worden gewijzigd. Probeer het opnieuw."
      );
    } finally {
      setLoading(false);
    }
  }

  if (recoveryState === "checking") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#14171A] px-5 text-white">
        <div className="text-center">
          <p className="font-display text-5xl text-[#D6FF3F]">GOW!</p>

          <p className="mt-4 font-display text-lg text-[#FF4B3E]">
            RESETLINK CONTROLEREN...
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
          </Link>

          <Link
            href={content.loginHref}
            className="hidden font-display text-base text-white transition hover:text-[#D6FF3F] sm:block"
          >
            {content.loginLabel} →
          </Link>
        </div>
      </header>

      {/* CONTENT */}
      <section className="relative flex flex-1 items-center overflow-hidden py-16 sm:py-20">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 top-1/2 -translate-y-1/2 select-none font-display text-[18rem] leading-none text-[#D6FF3F] opacity-[0.05] sm:text-[28rem] lg:text-[38rem]"
        >
          GOW
        </div>

        <div className="relative mx-auto grid w-full max-w-7xl gap-14 px-5 sm:px-8 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20">
          {/* Linkerkolom */}
          <div className="lg:self-center">
            <p className="font-display text-lg text-[#FF4B3E]">
              {content.kicker}
            </p>

            <h1 className="mt-4 max-w-3xl font-display text-6xl leading-[0.83] sm:text-7xl lg:text-8xl">
              NIEUW
              <br />
              WACHTWOORD.
              <br />
              GOW!
            </h1>

            <p className="mt-8 max-w-md text-lg leading-relaxed text-[#D7D9DA] sm:text-xl">
              Kies een nieuw veilig wachtwoord. Daarna log je weer in en ben je
              klaar om de baan op te gaan.
            </p>

            <div className="mt-10 border-l-2 border-[#D6FF3F] pl-5">
              <p className="font-display text-2xl text-[#D6FF3F]">
                BIJNA KLAAR.
              </p>

              <p className="mt-2 max-w-sm leading-relaxed text-[#B9BEC2]">
                Gebruik minimaal 6 tekens en bewaar je wachtwoord veilig.
              </p>
            </div>
          </div>

          {/* Reset-kaart */}
          <div className="mx-auto w-full max-w-xl border-2 border-white bg-white p-3 text-[#14171A] shadow-[10px_10px_0_0_#FF4B3E] sm:p-4">
            <div className="bg-[#14171A] p-5 text-white sm:p-8">
              {recoveryState === "invalid" ? (
                <>
                  <div className="border-b border-white/20 pb-6">
                    <p className="font-display text-xl text-[#FF4B3E]">
                      RESETLINK ONGELDIG.
                    </p>

                    <p className="mt-2 text-sm leading-relaxed text-[#B9BEC2]">
                      {content.invalidText}
                    </p>
                  </div>

                  <div className="mt-8">
                    <p className="font-display text-4xl leading-[0.85] text-[#D6FF3F]">
                      {content.invalidTitle}
                    </p>

                    <p className="mt-5 leading-relaxed text-[#D7D9DA]">
                      Resetlinks kunnen maar één keer worden gebruikt en
                      verlopen na verloop van tijd.
                    </p>

                    <Link
                      href={content.loginHref}
                      className="mt-8 flex w-full items-center justify-center gap-3 bg-[#FF4B3E] px-6 py-5 font-display text-xl text-white transition hover:bg-[#D6FF3F] hover:text-[#14171A]"
                    >
                      NAAR LOGIN
                      <span aria-hidden="true">→</span>
                    </Link>

                    <Link
                      href={content.registerHref}
                      className="mt-4 flex w-full items-center justify-center gap-3 border-2 border-white px-6 py-5 font-display text-xl text-white transition hover:bg-white hover:text-[#14171A]"
                    >
                      {content.registerLabel}
                      <span aria-hidden="true">→</span>
                    </Link>
                  </div>
                </>
              ) : null}

              {recoveryState === "success" ? (
                <>
                  <div className="border-b border-white/20 pb-6">
                    <p className="font-display text-xl text-[#D6FF3F]">
                      WACHTWOORD GEWIJZIGD.
                    </p>

                    <p className="mt-2 text-sm leading-relaxed text-[#B9BEC2]">
                      Je nieuwe wachtwoord is opgeslagen.
                    </p>
                  </div>

                  <div className="mt-8 border-l-2 border-[#D6FF3F] pl-5">
                    <p className="font-display text-4xl leading-[0.85]">
                      KLAAR?
                      <br />
                      GOW!
                    </p>

                    <p className="mt-4 leading-relaxed text-[#D7D9DA]">
                      Log opnieuw in met je nieuwe wachtwoord.
                    </p>
                  </div>

                  <Link
                    href={content.loginHref}
                    className="mt-8 flex w-full items-center justify-center gap-3 bg-[#FF4B3E] px-6 py-5 font-display text-xl text-white transition hover:bg-[#D6FF3F] hover:text-[#14171A]"
                  >
                    NAAR LOGIN
                    <span aria-hidden="true">→</span>
                  </Link>
                </>
              ) : null}

              {recoveryState === "ready" ? (
                <>
                  <div className="border-b border-white/20 pb-6">
                    <p className="font-display text-xl text-[#D6FF3F]">
                      KIES JE NIEUWE WACHTWOORD.
                    </p>

                    <p className="mt-2 text-sm leading-relaxed text-[#B9BEC2]">
                      Gebruik minimaal 6 tekens. Na het opslaan log je opnieuw
                      in met je nieuwe wachtwoord.
                    </p>
                  </div>

                  {errorMessage ? (
                    <div
                      role="alert"
                      className="mt-6 border-2 border-[#FF4B3E] bg-[#FF4B3E] px-4 py-3 text-sm font-semibold leading-relaxed text-white"
                    >
                      {errorMessage}
                    </div>
                  ) : null}

                  <form onSubmit={handleSubmit} className="mt-7 space-y-5">
                    <div>
                      <label
                        htmlFor="password"
                        className="mb-2 block font-display text-base text-[#FF4B3E]"
                      >
                        NIEUW WACHTWOORD
                      </label>

                      <input
                        id="password"
                        type="password"
                        value={password}
                        onChange={(event) => {
                          clearError();
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
                        type="password"
                        value={confirmPassword}
                        onChange={(event) => {
                          clearError();
                          setConfirmPassword(event.target.value);
                        }}
                        autoComplete="new-password"
                        placeholder="Herhaal je nieuwe wachtwoord"
                        className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none transition placeholder:text-[#8A8F94] focus:border-[#D6FF3F]"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="mt-8 flex w-full items-center justify-center gap-3 bg-[#FF4B3E] px-6 py-5 font-display text-xl text-white transition hover:-translate-y-1 hover:bg-[#D6FF3F] hover:text-[#14171A] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
                    >
                      {loading
                        ? "WACHTWOORD OPSLAAN..."
                        : "NIEUW WACHTWOORD OPSLAAN"}

                      {!loading ? <span aria-hidden="true">→</span> : null}
                    </button>
                  </form>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}