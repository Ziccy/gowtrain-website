"use client";

import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import { locations, type LocationOption } from "@/constants/locations";
import SiteFooter from "@/components/SiteFooter";
import { supabase } from "@/lib/supabase-browser";

type SportOption = "Padel" | "Tennis" | "Padel & Tennis";

const radiusOptions: number[] = [10, 25, 50, 100];

function getInitials(name: string): string {
  const parts = name.trim().split(" ").filter(Boolean);

  if (parts.length === 0) {
    return "GT";
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

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

export default function TrainerWordenPage() {
  const [name, setName] = useState<string>("");
  const [sport, setSport] = useState<SportOption>("Padel");
  const [focus, setFocus] = useState<string>("");
  const [location, setLocation] = useState<LocationOption | null>();
  const [locationQuery, setLocationQuery] = useState<string>("");
  const [showLocationResults, setShowLocationResults] = useState<boolean>(false);
  const [radiusKm, setRadiusKm] = useState<number>(25);
  const [price, setPrice] = useState<string>("");

  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [confirmPassword, setConfirmPassword] = useState<string>("");
  const [privacyAccepted, setPrivacyAccepted] = useState<boolean>(false);

  const [loading, setLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");

  const locationResults = useMemo((): LocationOption[] => {
    const query = locationQuery.trim().toLocaleLowerCase("nl-NL");

    if (query.length < 2) {
      return [];
    }

    return locations
      .filter((item: LocationOption) => {
        const searchableText =
          `${item.city} ${item.province} ${item.municipality ?? ""}`.toLocaleLowerCase("nl-NL");

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

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
      setErrorMessage("Zoek en kies je primaire stad of gemeente uit de lijst.");
      return;
    }

    if (!price.trim()) {
      setErrorMessage("Vul je prijs per uur in.");
      return;
    }

    const priceNumber = Number(price.replace(",", "."));

    if (Number.isNaN(priceNumber) || priceNumber <= 0) {
      setErrorMessage("Vul een geldige prijs per uur in.");
      return;
    }

    if (!email.trim()) {
      setErrorMessage("Vul je e-mailadres in.");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(email.trim())) {
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
      setErrorMessage("Ga akkoord met de privacyverklaring om je account aan te maken.");
      return;
    }

    const selectedLocation: LocationOption = location;
    setLoading(true);

    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
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

    setLoading(false);

    if (error) {
      console.error("Trainer registratie fout:", error.message);

      if (error.message.toLowerCase().includes("already registered")) {
        setErrorMessage(
          "Er bestaat al een account met dit e-mailadres. Log in via de GowTrain-app."
        );
        return;
      }

      setErrorMessage("Registreren lukt nu niet. Probeer het opnieuw of neem contact op.");
      return;
    }

    if (!data.session) {
      setSuccessMessage(
        "Je traineraccount is aangemaakt! Check je e-mail om je adres te bevestigen. Daarna kun je inloggen in de app."
      );
    } else {
      setSuccessMessage("Je traineraccount is aangemaakt! Je kunt nu direct inloggen in de app.");
    }

    setPassword("");
    setConfirmPassword("");
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
            <span className="mt-1 h-0 w-0 border-b-[9px] border-l-[8px] border-t-[9px] border-b-transparent border-l-[#D6FF3F] border-t-transparent transition-transform duration-200 group-hover:translate-x-1 sm:border-b-[11px] sm:border-l-[9px] sm:border-t-[11px]" />
          </a>

          <a
            href="/trainer-login"
            className="hidden font-display text-base text-white transition hover:text-[#D6FF3F] sm:block"
          >
            AL TRAINER? LOG IN →
          </a>
        </div>
      </header>

      <section className="relative flex-1 overflow-hidden py-12 sm:py-16 lg:py-20">
        {/* Achtergronddecoratie */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-12 top-0 select-none font-display text-[15rem] leading-none text-[#D6FF3F] opacity-[0.05] sm:text-[23rem] lg:text-[32rem]"
        >
          GOW
        </div>

        <div className="relative mx-auto grid max-w-7xl gap-12 px-5 sm:px-8 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
          
          {/* LINKERKOLOM: HERO + HOE HET WERKT */}
          <div className="space-y-10 lg:sticky lg:top-10 lg:self-start">
            <div>
              <p className="font-display text-lg text-[#FF4B3E]">TRAINER ACCOUNT</p>
              <h1 className="mt-2 font-display text-6xl leading-[0.83] sm:text-7xl lg:text-8xl">
                WORD<br />TRAINER.<br />GOW!
              </h1>
              <p className="mt-6 text-lg leading-relaxed text-[#D7D9DA] sm:text-xl">
                Jij geeft les, GowTrain regelt de rest. Krijg direct boekingen van spelers in jouw regio zonder marketing- of WhatsApp-chaos.
              </p>
            </div>

            {/* BLOCK: HOE HET WERKT (3 STAPPEN) */}
            <div className="border-t border-white/20 pt-8">
              <p className="font-display text-xl text-[#D6FF3F]">HOE HET WERKT</p>
              
              <div className="mt-6 space-y-6">
                <div className="flex gap-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center bg-[#D6FF3F] font-display text-base font-bold text-[#14171A]">
                    01
                  </span>
                  <div>
                    <h3 className="font-display text-lg text-white">BEPAAL JE EIGEN AGENDA</h3>
                    <p className="mt-1 text-sm text-[#B9BEC2]">
                      Stel je locaties, uurtarief en beschikbare tijdsloten in via de app. Jij houdt de volledige controle.
                    </p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center bg-[#D6FF3F] font-display text-base font-bold text-[#14171A]">
                    02
                  </span>
                  <div>
                    <h3 className="font-display text-lg text-white">SPELERS BOEKEN DIRECT</h3>
                    <p className="mt-1 text-sm text-[#B9BEC2]">
                      Spelers in jouw buurt vinden je profiel en boeken direct met één tik op de Gow!-knop. Geen heen-en-weer ge-app.
                    </p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center bg-[#D6FF3F] font-display text-base font-bold text-[#14171A]">
                    03
                  </span>
                  <div>
                    <h3 className="font-display text-lg text-white">AUTOMATISCHE UITBETALING</h3>
                    <p className="mt-1 text-sm text-[#B9BEC2]">
                      Betalingen worden vooraf geregeld in de app. Je geld staat na de les direct netjes op je rekening.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* HIGHLIGHT: NO CURE NO PAY / 5% COMMISSIE */}
            <div className="border-2 border-[#D6FF3F] bg-[#14171A] p-5 shadow-[6px_6px_0_0_#D6FF3F]">
              <p className="font-display text-lg text-[#D6FF3F]">GEEN MAANDELIJKSE KOSTEN</p>
              <p className="mt-2 text-sm leading-relaxed text-[#D7D9DA]">
                Registreren is <strong>100% gratis</strong>. Wij rekenen pas een kleine commissie van <strong>5% per geboekte les</strong>. Geen boekingen? Geen kosten.
              </p>
            </div>
          </div>

          {/* RECHTERKOLOM: FORMULIER */}
          <div className="border-2 border-white bg-white p-3 text-[#14171A] shadow-[10px_10px_0_0_#FF4B3E] sm:p-4">
            <div className="bg-[#14171A] p-5 sm:p-8">
              <div className="flex items-start justify-between gap-5 border-b border-white/20 pb-6">
                <div>
                  <p className="font-display text-xl text-[#D6FF3F]">MAAK JE PROFIEL.</p>
                  <p className="mt-2 text-sm leading-relaxed text-[#B9BEC2]">
                    Binnen 2 minuten staat jouw profiel klaar voor controle.
                  </p>
                </div>
                <span className="shrink-0 bg-[#FF4B3E] px-3 py-2 font-display text-sm text-white">
                  01 / 01
                </span>
              </div>

              {errorMessage && (
                <div role="alert" className="mt-6 border-2 border-[#FF4B3E] bg-[#FF4B3E] px-4 py-3 text-sm font-semibold text-white">
                  {errorMessage}
                </div>
              )}

              {successMessage && (
                <div role="status" className="mt-6 border-2 border-[#D6FF3F] bg-[#D6FF3F] px-4 py-3 text-sm font-semibold text-[#14171A]">
                  {successMessage}
                </div>
              )}

              <form onSubmit={handleSubmit} className="mt-7 space-y-7">
                {/* Naam */}
                <fieldset>
                  <legend className="font-display text-base text-[#FF4B3E]">JOUW GEGEVENS</legend>
                  <div className="mt-3">
                    <label htmlFor="name" className="mb-2 block text-sm font-semibold text-white">
                      VOOR- EN ACHTERNAAM
                    </label>
                    <input
                      id="name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoComplete="name"
                      placeholder="Bijv. Tom Peeters"
                      className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none transition placeholder:text-[#8A8F94] focus:border-[#D6FF3F]"
                    />
                  </div>
                </fieldset>

                {/* Sport */}
                <fieldset>
                  <legend className="font-display text-base text-[#FF4B3E]">SPORT</legend>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(["Padel", "Tennis", "Padel & Tennis"] as SportOption[]).map((option) => (
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

                {/* Focus */}
                <div>
                  <label htmlFor="focus" className="mb-2 block font-display text-base text-[#FF4B3E]">
                    JOUW SPECIALISATIE / FOCUS
                  </label>
                  <input
                    id="focus"
                    type="text"
                    value={focus}
                    onChange={(e) => setFocus(e.target.value)}
                    placeholder="Bijv. Tactiek & Gevorderden, Techniek, Beginners"
                    className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none transition placeholder:text-[#8A8F94] focus:border-[#D6FF3F]"
                  />
                  <p className="mt-2 text-sm text-[#8A8F94]">
                    Dit zien spelers direct op jouw trainerkaart in de app.
                  </p>
                </div>

                {/* Locatie */}
                <div className="relative">
                  <label htmlFor="location" className="mb-2 block font-display text-base text-[#FF4B3E]">
                    PRIMAIRE STAD / LOCATIE
                  </label>
                  <input
                    id="location"
                    type="text"
                    value={locationQuery}
                    onChange={(e) => handleLocationInput(e.target.value)}
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

                  {showLocationResults && locationQuery.trim().length >= 2 && (
                    <div className="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto border-2 border-[#D6FF3F] bg-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]">
                      {locationResults.length > 0 ? (
                        locationResults.map((option) => (
                          <button
                            key={getLocationId(option)}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => selectLocation(option)}
                            className="block w-full border-b border-white/15 px-4 py-4 text-left text-white transition last:border-b-0 hover:bg-[#D6FF3F] hover:text-[#14171A]"
                          >
                            <span className="block font-semibold">{option.city}</span>
                            <span className="mt-1 block text-sm opacity-70">
                              {option.province}{option.municipality ? ` · ${option.municipality}` : ""}
                            </span>
                          </button>
                        ))
                      ) : (
                        <p className="px-4 py-4 text-sm text-[#B9BEC2]">
                          Geen locatie gevonden. Probeer een andere plaatsnaam.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Werkgebied */}
                <fieldset>
                  <legend className="font-display text-base text-[#FF4B3E]">MAXIMALE REISAFSTAND</legend>
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

                {/* Uurtarief met duidelijke vermelding van de 5% commissie */}
                <div>
                  <label htmlFor="price" className="mb-2 block font-display text-base text-[#FF4B3E]">
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
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder="Bijv. 45"
                      className="w-full bg-transparent px-4 py-4 text-white outline-none placeholder:text-[#8A8F94]"
                    />
                  </div>
                  <p className="mt-2 text-xs text-[#8A8F94]">
                    💡 GowTrain houdt automatisch 5% commissie in per geboekte les voor platform- en uitbetalingskosten.
                  </p>
                </div>

                {/* Accountgegevens */}
                <div className="border-t border-white/20 pt-7">
                  <p className="font-display text-base text-[#FF4B3E]">INLOGGEGEVENS</p>
                  <div className="mt-4 space-y-4">
                    <div>
                      <label htmlFor="email" className="mb-2 block text-sm font-semibold text-white">
                        E-MAILADRES
                      </label>
                      <input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        autoComplete="email"
                        placeholder="jouwnaam@voorbeeld.nl"
                        className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none transition placeholder:text-[#8A8F94] focus:border-[#D6FF3F]"
                      />
                    </div>

                    <div>
                      <label htmlFor="password" className="mb-2 block text-sm font-semibold text-white">
                        WACHTWOORD
                      </label>
                      <input
                        id="password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="new-password"
                        placeholder="Minimaal 6 tekens"
                        className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none transition placeholder:text-[#8A8F94] focus:border-[#D6FF3F]"
                      />
                    </div>

                    <div>
                      <label htmlFor="confirmPassword" className="mb-2 block text-sm font-semibold text-white">
                        HERHAAL WACHTWOORD
                      </label>
                      <input
                        id="confirmPassword"
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        autoComplete="new-password"
                        placeholder="Herhaal je wachtwoord"
                        className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none transition placeholder:text-[#8A8F94] focus:border-[#D6FF3F]"
                      />
                    </div>
                  </div>
                </div>

                {/* Privacy checkbox */}
                <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-[#B9BEC2]">
                  <input
                    type="checkbox"
                    checked={privacyAccepted}
                    onChange={(e) => setPrivacyAccepted(e.target.checked)}
                    className="mt-1 h-5 w-5 shrink-0 accent-[#D6FF3F]"
                  />
                  <span>
                    Ik ga akkoord met de{" "}
                    <a
                      href="/privacy"
                      className="font-semibold text-[#D6FF3F] underline underline-offset-4 transition hover:text-white"
                    >
                      privacyverklaring
                    </a>{" "}
                    en de algemene voorwaarden voor trainers.
                  </span>
                </label>

                {/* Submit Knop */}
                <button
                  type="submit"
                  disabled={loading}
                  className="flex w-full items-center justify-center gap-3 bg-[#FF4B3E] px-6 py-5 font-display text-xl text-white transition hover:-translate-y-1 hover:bg-[#D6FF3F] hover:text-[#14171A] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
                >
                  {loading ? "PROFIEL MAKEN..." : "MELD JE AAN. GOW!"}
                  {!loading && <span aria-hidden="true">→</span>}
                </button>

                <p className="text-center text-xs leading-relaxed text-[#8A8F94]">
                  Na registratie sturen we een e-mail om je account te activeren.
                </p>
              </form>
            </div>
          </div>

        </div>
      </section>

      <SiteFooter />
    </main>
  );
}