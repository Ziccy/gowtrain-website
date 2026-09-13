"use client";

import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import Link from "next/link";
import { locations, type LocationOption } from "@/constants/locations";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { supabase } from "@/lib/supabase-browser";

type SportOption = "Padel" | "Tennis" | "Padel & Tennis";

const radiusOptions: number[] = [10, 25, 50, 100];

function getInitials(name: string): string {
  const parts = name.trim().split(" ").filter(Boolean);

  if (parts.length === 0) return "GT";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function formatLocation(location: LocationOption): string {
  return `${location.city}, ${location.province}`;
}

function getLocationId(location: LocationOption): string {
  return [
    location.city,
    location.province,
    location.countryCode,
    location.latitude,
    location.longitude,
  ].join("|");
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export default function TrainerWordenPage() {
  const [name, setName] = useState<string>("");
  const [sport, setSport] = useState<SportOption>("Padel");
  const [focus, setFocus] = useState<string>("");

  const [location, setLocation] = useState<LocationOption | null>();
  const [locationQuery, setLocationQuery] = useState<string>("");
  const [showLocationResults, setShowLocationResults] =
    useState<boolean>(false);

  const [radiusKm, setRadiusKm] = useState<number>(25);
  const [price, setPrice] = useState<string>("");

  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [confirmPassword, setConfirmPassword] = useState<string>("");
  const [privacyAccepted, setPrivacyAccepted] = useState<boolean>(false);

  const [loading, setLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");

  // Apart formulier voor het opnieuw versturen van de bevestigingsmail.
  const [resendEmail, setResendEmail] = useState<string>("");
  const [resending, setResending] = useState<boolean>(false);
  const [resendErrorMessage, setResendErrorMessage] = useState<string>("");
  const [resendSuccessMessage, setResendSuccessMessage] =
    useState<string>("");

  const isBusy = loading || resending;

  const locationResults = useMemo((): LocationOption[] => {
    const query = locationQuery.trim().toLocaleLowerCase("nl-NL");

    if (query.length < 2) return [];

    return locations
      .filter((item: LocationOption) => {
        const searchableText =
          `${item.city} ${item.province} ${item.municipality ?? ""}`
            .toLocaleLowerCase("nl-NL");

        return searchableText.includes(query);
      })
      .slice(0, 8);
  }, [locationQuery]);

  function handleLocationInput(value: string): void {
    setLocationQuery(value);
    setShowLocationResults(true);

    if (location) {
      setLocation(null);
    }
  }

  function selectLocation(selectedLocation: LocationOption): void {
    setLocation(selectedLocation);
    setLocationQuery(formatLocation(selectedLocation));
    setShowLocationResults(false);
  }

  async function handleResendConfirmation(
    event: FormEvent<HTMLFormElement>
  ): Promise<void> {
    event.preventDefault();

    if (isBusy) return;

    setResendErrorMessage("");
    setResendSuccessMessage("");

    const normalizedEmail = resendEmail.trim().toLowerCase();

    if (!normalizedEmail) {
      setResendErrorMessage(
        "Vul het e-mailadres in waarmee je je hebt aangemeld."
      );
      return;
    }

    if (!isValidEmail(normalizedEmail)) {
      setResendErrorMessage("Vul een geldig e-mailadres in.");
      return;
    }

    setResending(true);

    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: normalizedEmail,
        options: {
          emailRedirectTo:
            `${window.location.origin}/auth/bevestigd`,
        },
      });

      if (error) {
        if (error.status === 429) {
          setResendErrorMessage(
            "Er zijn te veel aanvragen gedaan. Wacht even en probeer opnieuw."
          );
          return;
        }

        setResendErrorMessage(
          "De bevestigingsmail kon niet worden aangevraagd. Wacht even en probeer opnieuw."
        );
        return;
      }

      setResendSuccessMessage(
        "Als dit account nog op e-mailbevestiging wacht, ontvang je een nieuwe mail. Check ook je spammap en gebruik de link uit de nieuwste mail."
      );
    } catch {
      setResendErrorMessage(
        "De bevestigingsmail kon niet worden aangevraagd. Controleer je verbinding en probeer opnieuw."
      );
    } finally {
      setResending(false);
    }
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ): Promise<void> {
    event.preventDefault();

    if (isBusy) return;

    setErrorMessage("");
    setSuccessMessage("");

    if (!name.trim()) {
      setErrorMessage("Vul je naam in.");
      return;
    }

    if (!focus.trim()) {
      setErrorMessage("Vul je specialisatie in.");
      return;
    }

    if (!location) {
      setErrorMessage(
        "Zoek en kies je primaire stad of gemeente uit de lijst."
      );
      return;
    }

    if (!price.trim()) {
      setErrorMessage("Vul je prijs per uur in.");
      return;
    }

    const priceNumber = Number(price.replace(",", "."));

    if (!Number.isFinite(priceNumber) || priceNumber <= 0) {
      setErrorMessage("Vul een geldige prijs per uur in.");
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      setErrorMessage("Vul je e-mailadres in.");
      return;
    }

    if (!isValidEmail(normalizedEmail)) {
      setErrorMessage("Vul een geldig e-mailadres in.");
      return;
    }

    if (!password.trim()) {
      setErrorMessage("Kies een wachtwoord.");
      return;
    }

    if (password.length < 6) {
      setErrorMessage("Je wachtwoord moet minimaal 6 tekens bevatten.");
      return;
    }

    if (!confirmPassword.trim()) {
      setErrorMessage("Herhaal je wachtwoord.");
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage("De wachtwoorden komen niet overeen.");
      return;
    }

    if (!privacyAccepted) {
      setErrorMessage(
        "Ga akkoord met de privacyverklaring en de algemene voorwaarden voor trainers om je account aan te maken."
      );
      return;
    }

    const selectedLocation: LocationOption = location;

    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          emailRedirectTo:
            `${window.location.origin}/auth/bevestigd`,
          data: {
            role: "trainer",
            full_name: name.trim(),
            initials: getInitials(name),
            sport,
            focus: focus.trim(),
            city: selectedLocation.city,
            province: selectedLocation.province,
            country_code: selectedLocation.countryCode,
            latitude: selectedLocation.latitude,
            longitude: selectedLocation.longitude,
            radius_km: radiusKm,
            price_per_hour: priceNumber,
          },
        },
      });

      if (error) {
        if (error.message.toLowerCase().includes("already registered")) {
          setErrorMessage(
            "Er bestaat al een account met dit e-mailadres. Log in met je traineraccount. Nog niet bevestigd? Gebruik het formulier onderaan om een nieuwe bevestigingsmail aan te vragen."
          );
          setResendEmail(normalizedEmail);
          return;
        }

        if (error.status === 429) {
          setErrorMessage(
            "Er zijn te veel aanvragen gedaan. Wacht even en probeer opnieuw."
          );
          return;
        }

        setErrorMessage(
          "Registreren lukt nu niet. Probeer het opnieuw of neem contact op."
        );
        return;
      }

      // Maak opnieuw versturen makkelijker na een aanmelding.
      setResendEmail(normalizedEmail);
      setResendErrorMessage("");
      setResendSuccessMessage("");

      if (!data.session) {
        // Supabase kan bij een bestaand account een neutrale
        // succesreactie geven. Daarom geen harde claim dat er
        // altijd een nieuw account of een nieuwe mail is aangemaakt.
        setSuccessMessage(
          "Check je e-mail om je aanmelding te bevestigen. Je trainerprofiel wordt daarnaast beoordeeld door Gowtrain. E-mailbevestiging is dus nog geen goedkeuring. Heb je al een bevestigd account? Log dan in."
        );
      } else {
        setSuccessMessage(
          "Je bent ingelogd. Je trainerprofiel moet nog worden goedgekeurd door Gowtrain voordat je actief kunt worden."
        );
      }

      setPassword("");
      setConfirmPassword("");
    } catch {
      setErrorMessage(
        "Registreren lukt nu niet. Controleer je verbinding en probeer opnieuw."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      <SiteHeader />

      <section className="relative flex-1 overflow-hidden py-10 sm:py-14">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-12 top-0 select-none font-display text-[15rem] leading-none text-[#D6FF3F] opacity-[0.05] sm:text-[23rem] lg:text-[32rem]"
        >
          GOW
        </div>

        <div className="relative mx-auto grid max-w-7xl gap-12 px-5 sm:px-8 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
          {/* LINKERKOLOM */}
          <div className="space-y-10 lg:sticky lg:top-10 lg:self-start">
            <div>
              <p className="font-display text-lg text-[#FF4B3E]">
                TRAINER ACCOUNT
              </p>

              <h1 className="mt-2 font-display text-6xl leading-[0.83] sm:text-7xl lg:text-8xl">
                WORD
                <br />
                TRAINER.
                <br />
                GOW!
              </h1>

              <p className="mt-6 text-lg leading-relaxed text-[#D7D9DA] sm:text-xl">
                Jij geeft les, GowTrain regelt de rest. Krijg direct
                boekingen van spelers in jouw regio zonder marketing- of
                WhatsApp-chaos.
              </p>
            </div>

            {/* HOE HET WERKT */}
            <div className="border-t border-white/20 pt-8">
              <p className="font-display text-xl text-[#D6FF3F]">
                HOE HET WERKT
              </p>

              <div className="mt-6 space-y-6">
                <div className="flex gap-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center bg-[#D6FF3F] font-display text-base font-bold text-[#14171A]">
                    01
                  </span>

                  <div>
                    <h3 className="font-display text-lg text-white">
                      BEPAAL JE EIGEN AGENDA
                    </h3>
                    <p className="mt-1 text-sm text-[#B9BEC2]">
                      Stel je locaties, uurtarief en beschikbare tijdsloten
                      in via je dashboard. Jij houdt de volledige controle.
                    </p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center bg-[#D6FF3F] font-display text-base font-bold text-[#14171A]">
                    02
                  </span>

                  <div>
                    <h3 className="font-display text-lg text-white">
                      SPELERS BOEKEN DIRECT
                    </h3>
                    <p className="mt-1 text-sm text-[#B9BEC2]">
                      Spelers in jouw buurt vinden je profiel en boeken
                      direct met één tik op de Gow!-knop. Geen
                      heen-en-weer ge-app.
                    </p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center bg-[#D6FF3F] font-display text-base font-bold text-[#14171A]">
                    03
                  </span>

                  <div>
                    <h3 className="font-display text-lg text-white">
                      AUTOMATISCHE UITBETALING
                    </h3>
                    <p className="mt-1 text-sm text-[#B9BEC2]">
                      Betalingen worden vooraf geregeld op het platform.
                      Je geld staat na de les direct netjes op je rekening.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* COMMISSIE */}
            <div className="border-2 border-[#D6FF3F] bg-[#14171A] p-5 shadow-[6px_6px_0_0_#D6FF3F]">
              <p className="font-display text-lg text-[#D6FF3F]">
                GEEN MAANDELIJKSE KOSTEN
              </p>
              <p className="mt-2 text-sm leading-relaxed text-[#D7D9DA]">
                Registreren is <strong>100% gratis</strong>. Wij rekenen
                pas een kleine commissie van{" "}
                <strong>5% per geboekte les</strong>. Geen boekingen?
                Geen kosten.
              </p>
            </div>

            {/* BESTAAND ACCOUNT */}
            <div className="border-t border-white/20 pt-6">
              <p className="font-display text-lg text-white">
                AL EEN TRAINERACCOUNT?
              </p>

              <Link
                href="/trainer-login"
                className="mt-3 inline-flex font-display text-base text-[#D6FF3F] transition hover:text-white"
              >
                LOGIN. GOW! →
              </Link>
            </div>
          </div>

          {/* RECHTERKOLOM */}
          <div className="border-2 border-white bg-white p-3 text-[#14171A] shadow-[10px_10px_0_0_#FF4B3E] sm:p-4">
            <div className="bg-[#14171A] p-5 sm:p-8">
              <div className="flex items-start justify-between gap-5 border-b border-white/20 pb-6">
                <div>
                  <p className="font-display text-xl text-[#D6FF3F]">
                    MAAK JE PROFIEL.
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-[#B9BEC2]">
                    Binnen 2 minuten staat jouw profiel klaar voor
                    controle.
                  </p>
                </div>

                <span className="shrink-0 bg-[#FF4B3E] px-3 py-2 font-display text-sm text-white">
                  01 / 01
                </span>
              </div>

              {errorMessage && (
                <div
                  role="alert"
                  className="mt-6 border-2 border-[#FF4B3E] bg-[#FF4B3E] px-4 py-3 text-sm font-semibold text-white"
                >
                  {errorMessage}
                </div>
              )}

              {successMessage && (
                <div
                  role="status"
                  className="mt-6 border-2 border-[#D6FF3F] bg-[#D6FF3F] px-4 py-3 text-sm font-semibold text-[#14171A]"
                >
                  <p>{successMessage}</p>

                  <Link
                    href="/trainer-login"
                    className="mt-3 inline-flex font-display text-base underline underline-offset-4"
                  >
                    NAAR TRAINERLOGIN →
                  </Link>
                </div>
              )}

              {/* REGISTRATIEFORMULIER */}
              <form onSubmit={handleSubmit} className="mt-7 space-y-7">
                {/* Naam */}
                <fieldset>
                  <legend className="font-display text-base text-[#FF4B3E]">
                    JOUW GEGEVENS
                  </legend>

                  <div className="mt-3">
                    <label
                      htmlFor="name"
                      className="mb-2 block text-sm font-semibold text-white"
                    >
                      VOOR- EN ACHTERNAAM
                    </label>

                    <input
                      id="name"
                      type="text"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      autoComplete="name"
                      placeholder="Bijv. Tom Peeters"
                      className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none transition placeholder:text-[#8A8F94] focus:border-[#D6FF3F]"
                    />
                  </div>
                </fieldset>

                {/* Sport */}
                <fieldset>
                  <legend className="font-display text-base text-[#FF4B3E]">
                    SPORT
                  </legend>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {(
                      ["Padel", "Tennis", "Padel & Tennis"] as SportOption[]
                    ).map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setSport(option)}
                        className={`border-2 px-4 py-3 font-display text-sm transition ${
                          sport === option
                            ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
                            : "border-white/30 bg-transparent text-white hover:border-white"
                        }`}
                      >
                        {option.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </fieldset>

                {/* Specialisatie */}
                <div>
                  <label
                    htmlFor="focus"
                    className="mb-2 block font-display text-base text-[#FF4B3E]"
                  >
                    JOUW SPECIALISATIE / FOCUS
                  </label>

                  <input
                    id="focus"
                    type="text"
                    value={focus}
                    onChange={(event) => setFocus(event.target.value)}
                    placeholder="Bijv. Tactiek & Gevorderden, Techniek, Beginners"
                    className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none transition placeholder:text-[#8A8F94] focus:border-[#D6FF3F]"
                  />

                  <p className="mt-2 text-sm text-[#8A8F94]">
                    Dit zien spelers direct op jouw trainerkaart op het
                    platform.
                  </p>
                </div>

                {/* Locatie */}
                <div className="relative">
                  <label
                    htmlFor="location"
                    className="mb-2 block font-display text-base text-[#FF4B3E]"
                  >
                    PRIMAIRE STAD / LOCATIE
                  </label>

                  <input
                    id="location"
                    type="text"
                    value={locationQuery}
                    onChange={(event) =>
                      handleLocationInput(event.target.value)
                    }
                    onFocus={() => setShowLocationResults(true)}
                    placeholder="Zoek op stad of gemeente"
                    autoComplete="off"
                    className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none transition placeholder:text-[#8A8F94] focus:border-[#D6FF3F]"
                  />

                  {location ? (
                    <p className="mt-2 text-sm text-[#D6FF3F]">
                      ✓ Geselecteerd: {formatLocation(location)}
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-[#8A8F94]">
                      Kies de plaats vanuit waar je meestal lesgeeft.
                    </p>
                  )}

                  {showLocationResults &&
                    locationQuery.trim().length >= 2 && (
                      <div className="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto border-2 border-[#D6FF3F] bg-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]">
                        {locationResults.length > 0 ? (
                          locationResults.map((option) => (
                            <button
                              key={getLocationId(option)}
                              type="button"
                              onMouseDown={(event) =>
                                event.preventDefault()
                              }
                              onClick={() => selectLocation(option)}
                              className="block w-full border-b border-white/15 px-4 py-4 text-left text-white transition last:border-b-0 hover:bg-[#D6FF3F] hover:text-[#14171A]"
                            >
                              <span className="block font-semibold">
                                {option.city}
                              </span>

                              <span className="mt-1 block text-sm opacity-70">
                                {option.province}
                                {option.municipality
                                  ? ` · ${option.municipality}`
                                  : ""}
                              </span>
                            </button>
                          ))
                        ) : (
                          <p className="px-4 py-4 text-sm text-[#B9BEC2]">
                            Geen locatie gevonden. Probeer een andere
                            plaatsnaam.
                          </p>
                        )}
                      </div>
                    )}
                </div>

                {/* Werkgebied */}
                <fieldset>
                  <legend className="font-display text-base text-[#FF4B3E]">
                    MAXIMALE REISAFSTAND
                  </legend>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {radiusOptions.map((radius) => (
                      <button
                        key={radius}
                        type="button"
                        onClick={() => setRadiusKm(radius)}
                        className={`border-2 px-4 py-3 font-display text-sm transition ${
                          radiusKm === radius
                            ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
                            : "border-white/30 bg-transparent text-white hover:border-white"
                        }`}
                      >
                        {radius} KM
                      </button>
                    ))}
                  </div>
                </fieldset>

                {/* Uurtarief */}
                <div>
                  <label
                    htmlFor="price"
                    className="mb-2 block font-display text-base text-[#FF4B3E]"
                  >
                    JOUW UURTARIEF (EXCL. BANENHUUR)
                  </label>

                  <div className="flex border-2 border-white/25 transition focus-within:border-[#D6FF3F]">
                    <span className="flex items-center border-r-2 border-white/25 px-4 font-display text-xl text-[#D6FF3F]">
                      €
                    </span>

                    <input
                      id="price"
                      type="number"
                      inputMode="decimal"
                      min="1"
                      step="0.5"
                      value={price}
                      onChange={(event) => setPrice(event.target.value)}
                      placeholder="Bijv. 45"
                      className="w-full bg-transparent px-4 py-4 text-white outline-none placeholder:text-[#8A8F94]"
                    />
                  </div>

                  <p className="mt-2 text-xs text-[#8A8F94]">
                    💡 GowTrain houdt automatisch 5% commissie in per
                    geboekte les voor platform- en uitbetalingskosten.
                  </p>
                </div>

                {/* Accountgegevens */}
                <div className="border-t border-white/20 pt-7">
                  <p className="font-display text-base text-[#FF4B3E]">
                    INLOGGEGEVENS
                  </p>

                  <div className="mt-4 space-y-4">
                    <div>
                      <label
                        htmlFor="email"
                        className="mb-2 block text-sm font-semibold text-white"
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
                        spellCheck={false}
                        placeholder="jouwnaam@voorbeeld.nl"
                        className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none transition placeholder:text-[#8A8F94] focus:border-[#D6FF3F]"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="password"
                        className="mb-2 block text-sm font-semibold text-white"
                      >
                        WACHTWOORD
                      </label>

                      <input
                        id="password"
                        type="password"
                        value={password}
                        onChange={(event) =>
                          setPassword(event.target.value)
                        }
                        autoComplete="new-password"
                        placeholder="Minimaal 6 tekens"
                        className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none transition placeholder:text-[#8A8F94] focus:border-[#D6FF3F]"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="confirmPassword"
                        className="mb-2 block text-sm font-semibold text-white"
                      >
                        HERHAAL WACHTWOORD
                      </label>

                      <input
                        id="confirmPassword"
                        type="password"
                        value={confirmPassword}
                        onChange={(event) =>
                          setConfirmPassword(event.target.value)
                        }
                        autoComplete="new-password"
                        placeholder="Herhaal je wachtwoord"
                        className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none transition placeholder:text-[#8A8F94] focus:border-[#D6FF3F]"
                      />
                    </div>
                  </div>
                </div>

                {/* Privacy */}
                <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-[#B9BEC2]">
                  <input
                    type="checkbox"
                    checked={privacyAccepted}
                    onChange={(event) =>
                      setPrivacyAccepted(event.target.checked)
                    }
                    className="mt-1 h-5 w-5 shrink-0 accent-[#D6FF3F]"
                  />

                  <span>
                    Ik ga akkoord met de{" "}
                    <Link
                      href="/privacy"
                      className="font-semibold text-[#D6FF3F] underline underline-offset-4 transition hover:text-white"
                    >
                      privacyverklaring
                    </Link>{" "}
                    en de algemene voorwaarden voor trainers.
                  </span>
                </label>

                {/* Registreren */}
                <button
                  type="submit"
                  disabled={isBusy}
                  className="flex w-full items-center justify-center gap-3 bg-[#FF4B3E] px-6 py-5 font-display text-xl text-white transition hover:-translate-y-1 hover:bg-[#D6FF3F] hover:text-[#14171A] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? "PROFIEL MAKEN..." : "MELD JE AAN. GOW!"}
                  {!loading && <span aria-hidden="true">→</span>}
                </button>

                <p className="text-center text-xs leading-relaxed text-[#8A8F94]">
                  Bevestig na registratie je e-mailadres via de mail.
                  Je trainerprofiel wordt apart beoordeeld door Gowtrain.
                  Je ontvangt bericht zodra je bent goedgekeurd.
                </p>
              </form>

              {/* APART FORMULIER: BEVESTIGINGSMAIL OPNIEUW VERSTUREN */}
              <section
                aria-labelledby="resend-confirmation-heading"
                className="mt-10 border-t-2 border-white/20 pt-7"
              >
                <h2
                  id="resend-confirmation-heading"
                  className="font-display text-xl text-[#D6FF3F]"
                >
                  BEVESTIGINGSLINK VERLOPEN?
                </h2>

                <p className="mt-3 text-sm leading-relaxed text-[#B9BEC2]">
                  Al aangemeld, maar je e-mailadres nog niet bevestigd?
                  Vraag hieronder een nieuwe bevestigingsmail aan.
                  Je hoeft je profiel niet opnieuw in te vullen.
                </p>

                {resendErrorMessage && (
                  <div
                    role="alert"
                    className="mt-5 border-2 border-[#FF4B3E] bg-[#FF4B3E] px-4 py-3 text-sm font-semibold text-white"
                  >
                    {resendErrorMessage}
                  </div>
                )}

                {resendSuccessMessage && (
                  <div
                    role="status"
                    className="mt-5 border-2 border-[#D6FF3F] bg-[#D6FF3F] px-4 py-3 text-sm font-semibold text-[#14171A]"
                  >
                    {resendSuccessMessage}
                  </div>
                )}

                <form
                  onSubmit={handleResendConfirmation}
                  className="mt-5 space-y-4"
                >
                  <div>
                    <label
                      htmlFor="resend-email"
                      className="mb-2 block text-sm font-semibold text-white"
                    >
                      E-MAILADRES VAN JE ACCOUNT
                    </label>

                    <input
                      id="resend-email"
                      type="email"
                      value={resendEmail}
                      onChange={(event) => {
                        setResendEmail(event.target.value);
                        setResendErrorMessage("");
                        setResendSuccessMessage("");
                      }}
                      required
                      autoComplete="email"
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder="jouwnaam@voorbeeld.nl"
                      className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none transition placeholder:text-[#8A8F94] focus:border-[#D6FF3F]"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isBusy}
                    className="w-full border-2 border-[#D6FF3F] px-5 py-4 font-display text-base text-[#D6FF3F] transition hover:bg-[#D6FF3F] hover:text-[#14171A] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {resending
                      ? "MAIL AANVRAGEN..."
                      : "STUUR NIEUWE BEVESTIGINGSMAIL"}
                  </button>
                </form>

                <p className="mt-4 text-xs leading-relaxed text-[#8A8F94]">
                  Hiermee bevestig je alleen je e-mailadres.
                  De beoordeling van je trainerprofiel verandert niet.
                </p>

                <Link
                  href="/trainer-login"
                  className="mt-5 inline-flex font-display text-sm text-[#D6FF3F] underline underline-offset-4 transition hover:text-white"
                >
                  AL BEVESTIGD? GA NAAR LOGIN →
                </Link>
              </section>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}