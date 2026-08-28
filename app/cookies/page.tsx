import Link from "next/link";
import SiteFooter from "@/components/SiteFooter";

const lastUpdated = "24 augustus 2026";

export default function CookiesPage() {
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
          COOKIES
        </div>

        <div className="relative mx-auto max-w-5xl px-5 sm:px-8">
          {/* Intro */}
          <div className="border-b-2 border-white/20 pb-8">
            <p className="font-display text-lg text-[#FF4B3E]">
              GOWTRAIN · JURIDISCH
            </p>

            <h1 className="mt-3 font-display text-6xl leading-[0.83] sm:text-7xl lg:text-8xl">
              COOKIE-
              <br />
              BELEID.
            </h1>

            <p className="mt-7 max-w-3xl text-lg leading-relaxed text-[#D7D9DA] sm:text-xl">
              Cookies helpen GowTrain goed te werken. We gebruiken alleen wat
              nodig is, en vragen toestemming wanneer dat moet.
            </p>

            <p className="mt-5 font-display text-sm text-[#D6FF3F]">
              LAATST BIJGEWERKT: {lastUpdated.toUpperCase()}
            </p>
          </div>

          {/* Cookie content */}
          <div className="mt-10 border-2 border-white bg-white p-3 text-[#14171A] shadow-[8px_8px_0_0_#FF4B3E]">
            <div className="bg-[#14171A] p-5 text-white sm:p-8 lg:p-10">
              <div className="space-y-12">
                <section>
                  <p className="font-display text-lg text-[#FF4B3E]">
                    01 / WAT ZIJN COOKIES?
                  </p>

                  <h2 className="mt-3 font-display text-4xl leading-[0.85] text-[#D6FF3F] sm:text-5xl">
                    KLEINE HULPERS.
                  </h2>

                  <p className="mt-5 max-w-3xl leading-relaxed text-[#D7D9DA]">
                    Cookies zijn kleine tekstbestanden die je browser op je
                    apparaat opslaat wanneer je een website bezoekt. Ze helpen
                    bijvoorbeeld om de website goed te laten functioneren,
                    instellingen te onthouden en inzicht te krijgen in het
                    gebruik van GowTrain.
                  </p>

                  <p className="mt-4 max-w-3xl leading-relaxed text-[#D7D9DA]">
                    Naast cookies kunnen we vergelijkbare technieken gebruiken,
                    zoals local storage, pixels en sessie-opslag. In dit beleid
                    noemen we deze samen “cookies”.
                  </p>
                </section>

                <section>
                  <p className="font-display text-lg text-[#FF4B3E]">
                    02 / WAAROM GEBRUIKEN WE COOKIES?
                  </p>

                  <h2 className="mt-3 font-display text-4xl leading-[0.85] text-[#D6FF3F] sm:text-5xl">
                    ZODAT GOWTRAIN WERKT.
                  </h2>

                  <p className="mt-5 leading-relaxed text-[#D7D9DA]">
                    GowTrain gebruikt cookies en vergelijkbare technieken voor
                    verschillende doelen:
                  </p>

                  <div className="mt-6 grid gap-4 md:grid-cols-3">
                    <div className="border-2 border-[#D6FF3F] p-5">
                      <p className="font-display text-2xl text-[#D6FF3F]">
                        01
                      </p>

                      <p className="mt-3 font-display text-lg text-white">
                        FUNCTIONEEL
                      </p>

                      <p className="mt-2 text-sm leading-relaxed text-[#B9BEC2]">
                        Voor inloggen, sessies, beveiliging en het correct laten
                        werken van het platform.
                      </p>
                    </div>

                    <div className="border-2 border-white/20 p-5">
                      <p className="font-display text-2xl text-[#D6FF3F]">
                        02
                      </p>

                      <p className="mt-3 font-display text-lg text-white">
                        ANALYTISCH
                      </p>

                      <p className="mt-2 text-sm leading-relaxed text-[#B9BEC2]">
                        Om te begrijpen welke onderdelen werken en waar we
                        GowTrain kunnen verbeteren.
                      </p>
                    </div>

                    <div className="border-2 border-[#FF4B3E] p-5">
                      <p className="font-display text-2xl text-[#FF4B3E]">
                        03
                      </p>

                      <p className="mt-3 font-display text-lg text-white">
                        MARKETING
                      </p>

                      <p className="mt-2 text-sm leading-relaxed text-[#B9BEC2]">
                        Alleen wanneer je hiervoor toestemming hebt gegeven en
                        wanneer we deze cookies daadwerkelijk gebruiken.
                      </p>
                    </div>
                  </div>
                </section>

                <section>
                  <p className="font-display text-lg text-[#FF4B3E]">
                    03 / FUNCTIONELE COOKIES
                  </p>

                  <h2 className="mt-3 font-display text-4xl leading-[0.85] text-[#D6FF3F] sm:text-5xl">
                    NODIG VOOR HET PLATFORM.
                  </h2>

                  <p className="mt-5 leading-relaxed text-[#D7D9DA]">
                    Functionele cookies zijn noodzakelijk om GowTrain veilig en
                    goed te laten werken. Voor deze cookies is doorgaans geen
                    toestemming nodig.
                  </p>

                  <div className="mt-6 border-l-2 border-[#D6FF3F] pl-5">
                    <p className="font-display text-lg text-white">
                      VOORBEELDEN
                    </p>

                    <ul className="mt-3 space-y-2 text-sm leading-relaxed text-[#B9BEC2]">
                      <li>
                        • Het onthouden van je ingelogde sessie als speler,
                        trainer of beheerder.
                      </li>
                      <li>
                        • Beveiliging van account- en boekingsfunctionaliteiten.
                      </li>
                      <li>
                        • Het tijdelijk bewaren van noodzakelijke
                        formulierinstellingen.
                      </li>
                      <li>
                        • Het voorkomen van misbruik en technische fouten.
                      </li>
                    </ul>
                  </div>

                  <p className="mt-5 text-sm leading-relaxed text-[#B9BEC2]">
                    GowTrain gebruikt voor account- en sessiebeheer onder meer
                    technische infrastructuur van Supabase. Deze sessiegegevens
                    zijn nodig om ingelogde functionaliteiten goed te laten
                    werken.
                  </p>
                </section>

                <section>
                  <p className="font-display text-lg text-[#FF4B3E]">
                    04 / ANALYTISCHE COOKIES
                  </p>

                  <h2 className="mt-3 font-display text-4xl leading-[0.85] text-[#D6FF3F] sm:text-5xl">
                    METEN OM BETER TE WORDEN.
                  </h2>

                  <p className="mt-5 leading-relaxed text-[#D7D9DA]">
                    Analytische cookies helpen ons te begrijpen hoe bezoekers
                    GowTrain gebruiken. Denk aan welke pagina’s worden bezocht,
                    welke onderdelen goed werken en waar gebruikers mogelijk
                    vastlopen.
                  </p>

                  <p className="mt-4 leading-relaxed text-[#D7D9DA]">
                    Wanneer analytische cookies niet noodzakelijk zijn, vragen
                    we vooraf om jouw toestemming. Je kunt die toestemming later
                    weer intrekken via je browserinstellingen of via de
                    cookie-instellingen van GowTrain, zodra deze beschikbaar
                    zijn.
                  </p>

                  <div className="mt-6 border-2 border-white/20 p-5">
                    <p className="font-display text-lg text-white">
                      ANALYTICS NOG NIET ACTIEF?
                    </p>

                    <p className="mt-2 text-sm leading-relaxed text-[#B9BEC2]">
                      Gebruik je op dit moment nog geen analyse-tool zoals
                      Google Analytics, Plausible, PostHog of Vercel Analytics?
                      Dan kun je dit onderdeel voorlopig laten staan, maar voeg
                      pas een cookiebanner en specifieke toolinformatie toe
                      zodra je analytics activeert.
                    </p>
                  </div>
                </section>

                <section>
                  <p className="font-display text-lg text-[#FF4B3E]">
                    05 / MARKETINGCOOKIES
                  </p>

                  <h2 className="mt-3 font-display text-4xl leading-[0.85] text-[#D6FF3F] sm:text-5xl">
                    ALLEEN MET TOESTEMMING.
                  </h2>

                  <p className="mt-5 leading-relaxed text-[#D7D9DA]">
                    Marketingcookies kunnen worden gebruikt om relevante
                    advertenties te tonen of om campagnes te meten. Denk
                    bijvoorbeeld aan cookies van Meta, Google Ads, TikTok of
                    andere advertentieplatformen.
                  </p>

                  <p className="mt-4 leading-relaxed text-[#D7D9DA]">
                    GowTrain plaatst dergelijke cookies alleen wanneer je
                    vooraf toestemming geeft. Je kunt je toestemming op ieder
                    moment intrekken.
                  </p>
                </section>

                <section>
                  <p className="font-display text-lg text-[#FF4B3E]">
                    06 / COOKIEOVERZICHT
                  </p>

                  <h2 className="mt-3 font-display text-4xl leading-[0.85] text-[#D6FF3F] sm:text-5xl">
                    WAT KAN ER STAAN?
                  </h2>

                  <div className="mt-6 overflow-x-auto border-2 border-white/20">
                    <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                      <thead className="bg-[#14171A] text-[#D6FF3F]">
                        <tr>
                          <th className="px-4 py-4 font-display">
                            CATEGORIE
                          </th>
                          <th className="px-4 py-4 font-display">DOEL</th>
                          <th className="px-4 py-4 font-display">
                            TOESTEMMING
                          </th>
                          <th className="px-4 py-4 font-display">
                            BEWAARTERMIJN
                          </th>
                        </tr>
                      </thead>

                      <tbody className="text-[#D7D9DA]">
                        <tr className="border-t border-white/20">
                          <td className="px-4 py-4 font-semibold text-white">
                            Functioneel
                          </td>
                          <td className="px-4 py-4">
                            Inloggen, sessie, veiligheid en basisfunctionaliteit.
                          </td>
                          <td className="px-4 py-4">Niet nodig</td>
                          <td className="px-4 py-4">
                            Sessie of volgens technische noodzaak
                          </td>
                        </tr>

                        <tr className="border-t border-white/20">
                          <td className="px-4 py-4 font-semibold text-white">
                            Analytisch
                          </td>
                          <td className="px-4 py-4">
                            Inzicht in gebruik en verbetering van GowTrain.
                          </td>
                          <td className="px-4 py-4">Indien vereist</td>
                          <td className="px-4 py-4">
                            Afhankelijk van de gebruikte tool
                          </td>
                        </tr>

                        <tr className="border-t border-white/20">
                          <td className="px-4 py-4 font-semibold text-white">
                            Marketing
                          </td>
                          <td className="px-4 py-4">
                            Advertenties, retargeting en campagnemeting.
                          </td>
                          <td className="px-4 py-4">Ja</td>
                          <td className="px-4 py-4">
                            Afhankelijk van de gebruikte tool
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <p className="mt-5 text-sm leading-relaxed text-[#B9BEC2]">
                    Vul dit overzicht vóór livegang aan met de exacte
                    cookienamen, aanbieders en bewaartermijnen zodra je
                    niet-functionele cookies activeert.
                  </p>
                </section>

                <section>
                  <p className="font-display text-lg text-[#FF4B3E]">
                    07 / COOKIES BEHEREN
                  </p>

                  <h2 className="mt-3 font-display text-4xl leading-[0.85] text-[#D6FF3F] sm:text-5xl">
                    JIJ KIEST.
                  </h2>

                  <p className="mt-5 leading-relaxed text-[#D7D9DA]">
                    Je kunt cookies verwijderen, blokkeren of beheren via de
                    instellingen van je browser. Houd er rekening mee dat delen
                    van GowTrain mogelijk minder goed werken wanneer je
                    functionele cookies blokkeert.
                  </p>

                  <div className="mt-6 grid gap-3 sm:grid-cols-2">
                    <a
                      href="https://support.google.com/chrome/answer/95647"
                      target="_blank"
                      rel="noreferrer"
                      className="border-2 border-white/20 px-5 py-4 font-display text-base text-white transition hover:border-[#D6FF3F] hover:text-[#D6FF3F]"
                    >
                      GOOGLE CHROME →
                    </a>

                    <a
                      href="https://support.mozilla.org/nl/kb/cookies-en-websitegegevens-wissen-firefox"
                      target="_blank"
                      rel="noreferrer"
                      className="border-2 border-white/20 px-5 py-4 font-display text-base text-white transition hover:border-[#D6FF3F] hover:text-[#D6FF3F]"
                    >
                      MOZILLA FIREFOX →
                    </a>

                    <a
                      href="https://support.apple.com/nl-nl/guide/safari/sfri11471/mac"
                      target="_blank"
                      rel="noreferrer"
                      className="border-2 border-white/20 px-5 py-4 font-display text-base text-white transition hover:border-[#D6FF3F] hover:text-[#D6FF3F]"
                    >
                      SAFARI →
                    </a>

                    <a
                      href="https://support.microsoft.com/nl-nl/microsoft-edge"
                      target="_blank"
                      rel="noreferrer"
                      className="border-2 border-white/20 px-5 py-4 font-display text-base text-white transition hover:border-[#D6FF3F] hover:text-[#D6FF3F]"
                    >
                      MICROSOFT EDGE →
                    </a>
                  </div>
                </section>

                <section>
                  <p className="font-display text-lg text-[#FF4B3E]">
                    08 / PRIVACY
                  </p>

                  <h2 className="mt-3 font-display text-4xl leading-[0.85] text-[#D6FF3F] sm:text-5xl">
                    MEER WETEN?
                  </h2>

                  <p className="mt-5 leading-relaxed text-[#D7D9DA]">
                    Wil je weten hoe GowTrain met persoonsgegevens omgaat? Lees
                    dan onze{" "}
                    <Link
                      href="/privacy"
                      className="font-semibold text-[#D6FF3F] underline underline-offset-4 hover:text-white"
                    >
                      privacyverklaring
                    </Link>
                    .
                  </p>
                </section>

                <section className="border-t-2 border-white/20 pt-8">
                  <p className="font-display text-3xl text-[#D6FF3F]">
                    VRAGEN?
                  </p>

                  <p className="mt-4 max-w-3xl leading-relaxed text-[#B9BEC2]">
                    Heb je vragen over cookies of privacy? Mail ons via{" "}
                    <a
                      href="mailto:info@gowtrain.nl"
                      className="font-semibold text-[#D6FF3F] underline underline-offset-4 hover:text-white"
                    >
                      info@gowtrain.nl
                    </a>
                    .
                  </p>
                </section>
              </div>
            </div>
          </div>

          {/* CTA */}
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