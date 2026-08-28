import Link from "next/link";
import SiteFooter from "@/components/SiteFooter";

const lastUpdated = "24 augustus 2026";

export default function PrivacyPage() {
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
            href="/"
            className="font-display text-sm text-white transition hover:text-[#D6FF3F]"
          >
            ← HOME
          </Link>
        </div>
      </header>

      {/* CONTENT */}
      <section className="relative flex-1 overflow-hidden py-12 sm:py-16 lg:py-20">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 -top-16 select-none font-display text-[15rem] leading-none text-[#D6FF3F] opacity-[0.04] sm:text-[24rem] lg:text-[32rem]"
        >
          PRIVACY
        </div>

        <div className="relative mx-auto max-w-5xl px-5 sm:px-8">
          {/* Intro */}
          <div className="border-b-2 border-white/20 pb-8">
            <p className="font-display text-lg text-[#FF4B3E]">
              GOWTRAIN · JURIDISCH
            </p>

            <h1 className="mt-3 font-display text-6xl leading-[0.83] sm:text-7xl lg:text-8xl">
              PRIVACY-
              <br />
              VERKLARING.
            </h1>

            <p className="mt-7 max-w-2xl text-lg leading-relaxed text-[#D7D9DA] sm:text-xl">
              Jouw gegevens zijn van jou. We gebruiken ze alleen om GowTrain
              te laten werken: trainers vinden, lessen boeken en trainingen
              beheren. Duidelijk, veilig en zonder gedoe.
            </p>

            <p className="mt-5 font-display text-sm text-[#D6FF3F]">
              LAATST BIJGEWERKT: {lastUpdated.toUpperCase()}
            </p>
          </div>

          {/* Content card */}
          <div className="mt-10 border-2 border-white bg-white p-3 text-[#14171A] shadow-[8px_8px_0_0_#FF4B3E]">
            <div className="bg-[#14171A] p-5 text-white sm:p-8 lg:p-10">
              <div className="space-y-12">
                <section>
                  <p className="font-display text-lg text-[#FF4B3E]">
                    01 / WIE ZIJN WIJ?
                  </p>

                  <h2 className="mt-3 font-display text-4xl leading-[0.85] text-[#D6FF3F] sm:text-5xl">
                    GOWTRAIN.
                  </h2>

                  <p className="mt-5 max-w-3xl leading-relaxed text-[#D7D9DA]">
                    GowTrain is een platform waarop spelers padel- en
                    tennistrainers kunnen vinden, vergelijken en boeken.
                    Trainers kunnen via GowTrain hun profiel, beschikbaarheid
                    en boekingen beheren.
                  </p>

                  <div className="mt-6 border-l-2 border-[#D6FF3F] pl-5 text-sm leading-relaxed text-[#B9BEC2]">
                    <p>
                      <strong className="text-white">
                        Verwerkingsverantwoordelijke:
                      </strong>{" "}
                      GowTrain [volledige bedrijfsnaam]
                    </p>
                    <p className="mt-1">
                      <strong className="text-white">Adres:</strong> [vestigingsadres]
                    </p>
                    <p className="mt-1">
                      <strong className="text-white">KVK-nummer:</strong> [KVK-nummer]
                    </p>
                    <p className="mt-1">
                      <strong className="text-white">E-mail:</strong>{" "}
                      <a
                        href="mailto:info@gowtrain.nl"
                        className="text-[#D6FF3F] underline underline-offset-4 hover:text-white"
                      >
                        info@gowtrain.nl
                      </a>
                    </p>
                  </div>
                </section>

                <section>
                  <p className="font-display text-lg text-[#FF4B3E]">
                    02 / WELKE GEGEVENS?
                  </p>

                  <h2 className="mt-3 font-display text-4xl leading-[0.85] text-[#D6FF3F] sm:text-5xl">
                    ALLEEN WAT NODIG IS.
                  </h2>

                  <p className="mt-5 leading-relaxed text-[#D7D9DA]">
                    Afhankelijk van hoe je GowTrain gebruikt, verwerken we de
                    volgende persoonsgegevens.
                  </p>

                  <div className="mt-6 grid gap-4 md:grid-cols-2">
                    <div className="border-2 border-white/20 p-5">
                      <p className="font-display text-xl text-white">
                        VOOR SPELERS
                      </p>

                      <ul className="mt-4 space-y-2 text-sm leading-relaxed text-[#B9BEC2]">
                        <li>• Naam</li>
                        <li>• E-mailadres</li>
                        <li>• Account- en inloggegevens</li>
                        <li>• Boekingsgegevens</li>
                        <li>• Eventuele berichten aan trainers</li>
                        <li>• Gegevens over gekozen trainingen</li>
                      </ul>
                    </div>

                    <div className="border-2 border-white/20 p-5">
                      <p className="font-display text-xl text-white">
                        VOOR TRAINERS
                      </p>

                      <ul className="mt-4 space-y-2 text-sm leading-relaxed text-[#B9BEC2]">
                        <li>• Naam en e-mailadres</li>
                        <li>• Profielfoto en biografie</li>
                        <li>• Sport, focus en specialisaties</li>
                        <li>• Stad, werkgebied en tarief</li>
                        <li>• Beschikbaarheid en boekingen</li>
                        <li>• Eventuele communicatie met spelers</li>
                      </ul>
                    </div>
                  </div>
                </section>

                <section>
                  <p className="font-display text-lg text-[#FF4B3E]">
                    03 / WAAROM?
                  </p>

                  <h2 className="mt-3 font-display text-4xl leading-[0.85] text-[#D6FF3F] sm:text-5xl">
                    OM GOWTRAIN TE LATEN WERKEN.
                  </h2>

                  <div className="mt-6 space-y-4">
                    <div className="border-l-2 border-[#D6FF3F] pl-5">
                      <p className="font-display text-lg text-white">
                        ACCOUNT AANMAKEN EN BEHEREN
                      </p>
                      <p className="mt-2 text-sm leading-relaxed text-[#B9BEC2]">
                        Om je toegang te geven tot je speler- of traineraccount.
                      </p>
                    </div>

                    <div className="border-l-2 border-[#FF4B3E] pl-5">
                      <p className="font-display text-lg text-white">
                        TRAINERS EN SPELERS KOPPELEN
                      </p>
                      <p className="mt-2 text-sm leading-relaxed text-[#B9BEC2]">
                        Om trainerprofielen, locaties, beschikbaarheid en
                        boekingsmogelijkheden te tonen.
                      </p>
                    </div>

                    <div className="border-l-2 border-white pl-5">
                      <p className="font-display text-lg text-white">
                        BOEKINGEN UITVOEREN
                      </p>
                      <p className="mt-2 text-sm leading-relaxed text-[#B9BEC2]">
                        Om een aanvraag bij een trainer te plaatsen, de status
                        te beheren en relevante gegevens met betrokken partijen
                        te delen.
                      </p>
                    </div>

                    <div className="border-l-2 border-[#D6FF3F] pl-5">
                      <p className="font-display text-lg text-white">
                        VEILIGHEID EN ONDERSTEUNING
                      </p>
                      <p className="mt-2 text-sm leading-relaxed text-[#B9BEC2]">
                        Om fraude, misbruik en technische problemen te
                        voorkomen, en om vragen te beantwoorden.
                      </p>
                    </div>
                  </div>
                </section>

                <section>
                  <p className="font-display text-lg text-[#FF4B3E]">
                    04 / GRONDSLAG
                  </p>

                  <h2 className="mt-3 font-display text-4xl leading-[0.85] text-[#D6FF3F] sm:text-5xl">
                    DUIDELIJKE REDENEN.
                  </h2>

                  <p className="mt-5 leading-relaxed text-[#D7D9DA]">
                    We verwerken persoonsgegevens alleen wanneer daar een
                    geldige wettelijke grondslag voor is. Dat is meestal:
                  </p>

                  <ul className="mt-5 space-y-3 text-sm leading-relaxed text-[#B9BEC2]">
                    <li>
                      <strong className="text-white">Uitvoering van een overeenkomst:</strong>{" "}
                      bijvoorbeeld wanneer je een account aanmaakt, een training
                      aanvraagt of als trainer je profiel en boekingen beheert.
                    </li>
                    <li>
                      <strong className="text-white">Gerechtvaardigd belang:</strong>{" "}
                      bijvoorbeeld voor platformbeveiliging, fraudepreventie,
                      productverbetering en klantenservice.
                    </li>
                    <li>
                      <strong className="text-white">Toestemming:</strong>{" "}
                      wanneer dit nodig is, bijvoorbeeld voor bepaalde cookies
                      of marketingcommunicatie.
                    </li>
                    <li>
                      <strong className="text-white">Wettelijke verplichting:</strong>{" "}
                      wanneer we gegevens moeten bewaren of delen op grond van
                      de wet.
                    </li>
                  </ul>
                </section>

                <section>
                  <p className="font-display text-lg text-[#FF4B3E]">
                    05 / DELEN VAN GEGEVENS
                  </p>

                  <h2 className="mt-3 font-display text-4xl leading-[0.85] text-[#D6FF3F] sm:text-5xl">
                    ALLEEN ALS HET NODIG IS.
                  </h2>

                  <p className="mt-5 leading-relaxed text-[#D7D9DA]">
                    Wanneer je een training aanvraagt, delen we gegevens die
                    nodig zijn om die aanvraag af te handelen met de betreffende
                    trainer. Denk aan je naam, e-mailadres en eventueel je
                    bericht bij de aanvraag.
                  </p>

                  <p className="mt-4 leading-relaxed text-[#D7D9DA]">
                    Trainers kunnen gegevens van spelers uitsluitend gebruiken
                    voor het behandelen en uitvoeren van een training of
                    boekingsaanvraag. Zij mogen deze gegevens niet gebruiken
                    voor andere doeleinden zonder geldige grondslag.
                  </p>

                  <p className="mt-4 leading-relaxed text-[#D7D9DA]">
                    Daarnaast gebruiken we zorgvuldig geselecteerde
                    dienstverleners voor onder andere hosting, databasebeheer,
                    e-mail en technische infrastructuur. Met partijen die
                    persoonsgegevens voor ons verwerken, maken we waar nodig
                    verwerkersafspraken.
                  </p>

                  <div className="mt-6 border-2 border-white/20 p-5">
                    <p className="font-display text-lg text-white">
                      GEEN VERKOOP VAN JOUW DATA.
                    </p>

                    <p className="mt-2 text-sm leading-relaxed text-[#B9BEC2]">
                      GowTrain verkoopt jouw persoonsgegevens niet aan derden.
                    </p>
                  </div>
                </section>

                <section>
                  <p className="font-display text-lg text-[#FF4B3E]">
                    06 / BEWAARTERMIJN
                  </p>

                  <h2 className="mt-3 font-display text-4xl leading-[0.85] text-[#D6FF3F] sm:text-5xl">
                    NIET LANGER DAN NODIG.
                  </h2>

                  <p className="mt-5 leading-relaxed text-[#D7D9DA]">
                    We bewaren persoonsgegevens niet langer dan nodig is voor
                    de doelen waarvoor we ze verwerken, tenzij een wettelijke
                    bewaarplicht een langere termijn vereist.
                  </p>

                  <ul className="mt-5 space-y-3 text-sm leading-relaxed text-[#B9BEC2]">
                    <li>
                      <strong className="text-white">Accountgegevens:</strong>{" "}
                      zolang je account actief is, en daarna zolang nodig voor
                      afhandeling, beveiliging of wettelijke verplichtingen.
                    </li>
                    <li>
                      <strong className="text-white">Boekingsgegevens:</strong>{" "}
                      zolang nodig voor de uitvoering van de training, service,
                      administratie en eventuele geschillen.
                    </li>
                    <li>
                      <strong className="text-white">Financiële gegevens:</strong>{" "}
                      voor zover van toepassing volgens de wettelijke
                      bewaartermijnen.
                    </li>
                  </ul>
                </section>

                <section>
                  <p className="font-display text-lg text-[#FF4B3E]">
                    07 / BEVEILIGING
                  </p>

                  <h2 className="mt-3 font-display text-4xl leading-[0.85] text-[#D6FF3F] sm:text-5xl">
                    SERIEUS BEVEILIGD.
                  </h2>

                  <p className="mt-5 leading-relaxed text-[#D7D9DA]">
                    We nemen passende technische en organisatorische maatregelen
                    om persoonsgegevens te beschermen tegen verlies, misbruik,
                    onbevoegde toegang en ongeoorloofde wijzigingen.
                  </p>

                  <p className="mt-4 leading-relaxed text-[#D7D9DA]">
                    Dit betekent onder andere dat toegang tot gegevens is
                    beperkt op basis van rollen, dat accounts met wachtwoorden
                    worden beveiligd en dat we gebruikmaken van beveiligde
                    verbindingen en betrouwbare technische leveranciers.
                  </p>
                </section>

                <section>
                  <p className="font-display text-lg text-[#FF4B3E]">
                    08 / JOUW RECHTEN
                  </p>

                  <h2 className="mt-3 font-display text-4xl leading-[0.85] text-[#D6FF3F] sm:text-5xl">
                    JIJ HOUDT DE CONTROLE.
                  </h2>

                  <p className="mt-5 leading-relaxed text-[#D7D9DA]">
                    Je hebt onder de AVG verschillende rechten met betrekking
                    tot jouw persoonsgegevens. Je kunt onder meer verzoeken om:
                  </p>

                  <div className="mt-6 grid gap-3 sm:grid-cols-2">
                    {[
                      "Inzage in jouw gegevens",
                      "Correctie van onjuiste gegevens",
                      "Verwijdering van jouw gegevens",
                      "Beperking van verwerking",
                      "Overdracht van gegevens",
                      "Bezwaar tegen verwerking",
                      "Intrekken van toestemming",
                    ].map((right) => (
                      <div
                        key={right}
                        className="border-l-2 border-[#D6FF3F] pl-4 text-sm text-[#B9BEC2]"
                      >
                        {right}
                      </div>
                    ))}
                  </div>

                  <p className="mt-6 leading-relaxed text-[#D7D9DA]">
                    Wil je gebruikmaken van een van deze rechten? Mail dan naar{" "}
                    <a
                      href="mailto:info@gowtrain.nl"
                      className="font-semibold text-[#D6FF3F] underline underline-offset-4 hover:text-white"
                    >
                      info@gowtrain.nl
                    </a>
                    . We kunnen vragen om aanvullende informatie om je identiteit
                    te controleren.
                  </p>
                </section>

                <section>
                  <p className="font-display text-lg text-[#FF4B3E]">
                    09 / COOKIES
                  </p>

                  <h2 className="mt-3 font-display text-4xl leading-[0.85] text-[#D6FF3F] sm:text-5xl">
                    FUNCTIONEEL EN HELDER.
                  </h2>

                  <p className="mt-5 leading-relaxed text-[#D7D9DA]">
                    GowTrain kan cookies en vergelijkbare technieken gebruiken
                    om de website goed te laten werken, je sessie te behouden
                    en het gebruik van het platform te analyseren.
                  </p>

                  <p className="mt-4 leading-relaxed text-[#D7D9DA]">
                    Lees meer in ons{" "}
                    <Link
                      href="/cookies"
                      className="font-semibold text-[#D6FF3F] underline underline-offset-4 hover:text-white"
                    >
                      cookiebeleid
                    </Link>
                    .
                  </p>
                </section>

                <section>
                  <p className="font-display text-lg text-[#FF4B3E]">
                    10 / CONTACT EN KLACHTEN
                  </p>

                  <h2 className="mt-3 font-display text-4xl leading-[0.85] text-[#D6FF3F] sm:text-5xl">
                    VRAGEN? LAAT HET WETEN.
                  </h2>

                  <p className="mt-5 leading-relaxed text-[#D7D9DA]">
                    Heb je vragen over deze privacyverklaring of over de manier
                    waarop GowTrain met jouw gegevens omgaat? Neem contact op
                    via{" "}
                    <a
                      href="mailto:info@gowtrain.nl"
                      className="font-semibold text-[#D6FF3F] underline underline-offset-4 hover:text-white"
                    >
                      info@gowtrain.nl
                    </a>
                    .
                  </p>

                  <p className="mt-4 leading-relaxed text-[#D7D9DA]">
                    Kom je er met ons niet uit, dan heb je het recht een klacht
                    in te dienen bij de Autoriteit Persoonsgegevens.
                  </p>
                </section>

                <section className="border-t-2 border-white/20 pt-8">
                  <p className="font-display text-3xl text-[#D6FF3F]">
                    WIJZIGINGEN.
                  </p>

                  <p className="mt-4 max-w-3xl leading-relaxed text-[#B9BEC2]">
                    We kunnen deze privacyverklaring aanpassen wanneer
                    GowTrain, wetgeving of onze dienstverlening verandert. De
                    meest actuele versie staat altijd op deze pagina.
                  </p>
                </section>
              </div>
            </div>
          </div>

          {/* CTA onderaan */}
          <div className="mt-10 flex flex-col justify-between gap-5 border-t-2 border-white/20 pt-8 sm:flex-row sm:items-center">
            <p className="font-display text-2xl">
              KLAAR OM DE BAAN OP TE GAAN?
            </p>

            <Link
              href="/trainers"
              className="inline-flex w-fit items-center gap-3 bg-[#FF4B3E] px-6 py-4 font-display text-lg text-white transition hover:-translate-y-1 hover:bg-[#D6FF3F] hover:text-[#14171A]"
            >
              VIND EEN TRAINER
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}