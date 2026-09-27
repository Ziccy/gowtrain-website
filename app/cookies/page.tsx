import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";

const lastUpdated = "27 september 2026";

/*
 * Pas op false zetten na controle van de daadwerkelijke
 * browseropslag en externe scripts op de gedeployde website,
 * waaronder Stripe Embedded Checkout.
 */
const isDraft = true;

const storageItems = [
  {
    name: "Ingelogde sessie",
    provider: "Gowtrain / Supabase",
    technology: "Lokale browseropslag (localStorage)",
    purpose:
      "Je ingelogde sessie bewaren en vernieuwen, zodat je accountfuncties kunt gebruiken.",
    duration:
      "Niet beperkt tot één tabblad of browsersessie. De sessie kan worden vernieuwd. De opslag wordt bij normaal uitloggen door de gebruikte client opgeruimd of kan via je browser worden verwijderd. Het verlopen van een toegangstoken is niet automatisch de verwijderdatum van alle lokaal opgeslagen sessiegegevens.",
  },
  {
    name: "Themavoorkeur",
    provider: "Gowtrain / next-themes",
    technology: "Lokale browseropslag (localStorage)",
    purpose:
      "Je gekozen lichte of donkere weergave onthouden.",
    duration:
      "Geen vaste automatische vervaldatum in de huidige configuratie. De voorkeur blijft doorgaans bewaard totdat je deze wijzigt of de websitegegevens verwijdert.",
  },
  {
    name: "Betalen via Stripe",
    provider: "Stripe",
    technology:
      "Externe scripts, ingesloten betaalinhoud en mogelijk cookies of vergelijkbare technieken",
    purpose:
      "Het betaalscherm aanbieden, betalingen ondersteunen en betaalgerelateerde beveiliging en fraudepreventie uitvoeren.",
    duration:
      "Bij onze checkout zijn de cookies __stripe_sid en __stripe_mid aangetroffen op .www.gowtrain.com. Stripe gebruikt deze voor beveiliging en fraudepreventie. De gebruikelijke looptijd is respectievelijk 30 minuten en één jaar; de waargenomen vervaldata passen daarbij. Bij hernieuwd gebruik kan de vervaldatum worden vernieuwd. Andere betaalfuncties kunnen aanvullende opslag gebruiken.",
  },
];

export default function CookiesPage() {
  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      <SiteHeader />

      <section className="relative flex-1 overflow-hidden py-12 sm:py-16 lg:py-20">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 -top-16 select-none font-display text-[15rem] leading-none text-[#D6FF3F] opacity-[0.04] sm:text-[24rem] lg:text-[32rem]"
        >
          COOKIES
        </div>

        <div className="relative mx-auto max-w-5xl px-5 sm:px-8">
          <div className="border-b-2 border-white/20 pb-8">
            <p className="font-display text-lg text-[#FF4B3E]">
              GOWTRAIN · COOKIES &amp; OPSLAG
            </p>

            <h1 className="mt-3 font-display text-6xl leading-[0.83] sm:text-7xl lg:text-8xl">
              COOKIE-
              <br />
              BELEID.
            </h1>

            <p className="mt-7 max-w-3xl text-lg leading-relaxed text-[#D7D9DA] sm:text-xl">
              Hier lees je welke cookies en vergelijkbare
              opslagtechnieken bij het gebruik van Gowtrain
              een rol spelen, waarvoor ze dienen en hoe je
              opgeslagen gegevens kunt beheren.
            </p>

            <p className="mt-5 font-display text-sm text-[#D6FF3F]">
              LAATST BIJGEWERKT: {lastUpdated.toUpperCase()}
            </p>
          </div>

          {isDraft && (
            <aside className="mt-8 border-2 border-[#FF4B3E] bg-white/5 p-5">
              <h2 className="font-display text-xl text-[#FF8A80]">
                CONCEPT · TECHNISCHE CONTROLE NOG OPEN
              </h2>

              <p className="mt-3 text-sm leading-relaxed text-[#D7D9DA]">
                Dit overzicht is gebaseerd op de huidige
                applicatiecode en bekende instellingen.
                De exacte opslag door Stripe en eventuele
                aanvullende hosting- of beveiligingsdiensten
                moet nog op de gedeployde website worden
                gecontroleerd. Het overzicht is daarom nog
                niet definitief.
              </p>
            </aside>
          )}

          <div className="mt-10 border-2 border-white bg-white p-3 text-[#14171A] shadow-[8px_8px_0_0_#FF4B3E]">
            <div className="bg-[#14171A] p-5 text-white sm:p-8 lg:p-10">
              <div className="space-y-12">
                <section>
                  <p className="font-display text-lg text-[#FF4B3E]">
                    01 / TECHNIEKEN
                  </p>

                  <h2 className="mt-3 font-display text-3xl leading-tight text-[#D6FF3F] sm:text-4xl">
                    MEER DAN ALLEEN COOKIES.
                  </h2>

                  <p className="mt-5 leading-relaxed text-[#D7D9DA]">
                    Cookies zijn kleine gegevensbestanden die
                    een website via je browser kan opslaan.
                    De browser kan deze bij volgende aanvragen
                    naar het betreffende domein meesturen.
                  </p>

                  <p className="mt-4 leading-relaxed text-[#D7D9DA]">
                    LocalStorage en sessionStorage zijn andere
                    vormen van browseropslag. Ze worden niet
                    zoals cookies automatisch met iedere
                    aanvraag meegestuurd, maar kunnen door
                    scripts worden gelezen. Ook daarop kunnen
                    regels voor opslag en toegang op je
                    apparaat van toepassing zijn.
                  </p>

                  <p className="mt-4 leading-relaxed text-[#D7D9DA]">
                    LocalStorage kan na het sluiten van je
                    browser blijven bestaan. SessionStorage
                    is gekoppeld aan een browsersessie of
                    tabblad; herstelgedrag kan per browser
                    verschillen.
                  </p>
                </section>

                <section>
                  <p className="font-display text-lg text-[#FF4B3E]">
                    02 / HUIDIG GEBRUIK
                  </p>

                  <h2 className="mt-3 font-display text-3xl leading-tight text-[#D6FF3F] sm:text-4xl">
                    INLOGGEN, WEERGAVE EN BETALEN.
                  </h2>

                  <p className="mt-5 leading-relaxed text-[#D7D9DA]">
                    In onze huidige website gebruiken we
                    lokale opslag voor je ingelogde sessie
                    en gekozen weergave. Voor betalingen is
                    een betaalscherm van Stripe geïntegreerd.
                  </p>

                  <div className="mt-6 space-y-5">
                    {storageItems.map((item) => (
                      <article
                        key={item.name}
                        className="border border-white/25 p-5"
                      >
                        <h3 className="font-display text-xl text-[#D6FF3F]">
                          {item.name.toUpperCase()}
                        </h3>

                        <dl className="mt-4 space-y-4 text-sm leading-relaxed">
                          <div>
                            <dt className="font-semibold text-white">
                              Aanbieder
                            </dt>
                            <dd className="mt-1 text-[#B9BEC2]">
                              {item.provider}
                            </dd>
                          </div>

                          <div>
                            <dt className="font-semibold text-white">
                              Techniek
                            </dt>
                            <dd className="mt-1 text-[#B9BEC2]">
                              {item.technology}
                            </dd>
                          </div>

                          <div>
                            <dt className="font-semibold text-white">
                              Doel
                            </dt>
                            <dd className="mt-1 text-[#B9BEC2]">
                              {item.purpose}
                            </dd>
                          </div>

                          <div>
                            <dt className="font-semibold text-white">
                              Bewaring en verwijdering
                            </dt>
                            <dd className="mt-1 text-[#B9BEC2]">
                              {item.duration}
                            </dd>
                          </div>
                        </dl>
                      </article>
                    ))}
                  </div>
                </section>

                <section>
                  <p className="font-display text-lg text-[#FF4B3E]">
                    03 / STRIPE
                  </p>

                  <h2 className="mt-3 font-display text-3xl leading-tight text-[#D6FF3F] sm:text-4xl">
                    HET INGESLOTEN BETAALSCHERM.
                  </h2>

                  <p className="mt-5 leading-relaxed text-[#D7D9DA]">
                    Onze checkout gebruikt Stripe Embedded
                    Checkout. De checkoutcode initialiseert
                    Stripe bij het laden van die module.
                    Dat gebeurt dus niet pas nadat je de
                    betaling definitief bevestigt.
                  </p>

                  <p className="mt-4 leading-relaxed text-[#D7D9DA]">
                    Bij het laden van externe betaalinhoud
                    worden technische gegevens naar Stripe
                    verstuurd, bijvoorbeeld gegevens die
                    nodig zijn om de verbinding en het
                    betaalscherm te laten werken. Afhankelijk
                    van de gebruikte functies kan Stripe
                    ook opslagtechnieken op je apparaat
                    gebruiken.
                  </p>

                  <p className="mt-4 leading-relaxed text-[#D7D9DA]">
                    Of voorafgaande toestemming nodig is,
                    hangt af van het concrete doel en de
                    noodzakelijkheid van de gebruikte
                    techniek. Niet iedere techniek van een
                    betaaldienst is automatisch vrijgesteld
                    alleen omdat die bij een betaling wordt
                    gebruikt.
                  </p>

                  <p className="mt-5 text-sm">
                    <a
                      href="https://stripe.com/legal/cookies-policy"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#D6FF3F] underline underline-offset-4 hover:text-white"
                    >
                      Lees de cookie-informatie van Stripe
                    </a>
                  </p>
                </section>

                <section>
                  <p className="font-display text-lg text-[#FF4B3E]">
                    04 / ANALYSE EN MARKETING
                  </p>

                  <h2 className="mt-3 font-display text-3xl leading-tight text-[#D6FF3F] sm:text-4xl">
                    GEEN EIGEN TRACKINGINTEGRATIE INGESCHAKELD.
                  </h2>

                  <p className="mt-5 leading-relaxed text-[#D7D9DA]">
                    In de gecontroleerde huidige
                    applicatiecode is geen afzonderlijke
                    analytics- of marketingtrackingintegratie
                    aangetroffen. Vercel Web Analytics en
                    Speed Insights staan uit.
                  </p>

                  <p className="mt-4 leading-relaxed text-[#D7D9DA]">
                    Dit betekent niet dat er geen technische
                    serverlogs of gegevensverwerking door
                    hosting- en betaaldiensten bestaan.
                    Technische logging en browsertracking
                    zijn verschillende vormen van verwerking.
                  </p>

                  <p className="mt-4 leading-relaxed text-[#D7D9DA]">
                    Voordat we nieuwe analyse- of
                    marketingtechnieken activeren, beoordelen
                    we welke informatie en toestemming nodig
                    zijn. Technieken waarvoor toestemming
                    vereist is, mogen niet al vóór die
                    toestemming actief zijn.
                  </p>
                </section>

                <section>
                  <p className="font-display text-lg text-[#FF4B3E]">
                    05 / TOESTEMMING
                  </p>

                  <h2 className="mt-3 font-display text-3xl leading-tight text-[#D6FF3F] sm:text-4xl">
                    GEEN TOESTEMMING DOOR ALLEEN BEZOEKEN.
                  </h2>

                  <p className="mt-5 leading-relaxed text-[#D7D9DA]">
                    Opslag die strikt noodzakelijk is voor
                    een door jou gevraagde dienst kan onder
                    een uitzondering op de toestemmingsplicht
                    vallen. Denk aan noodzakelijke
                    inlogfunctionaliteit of het onthouden
                    van een door jou gekozen weergave.
                    De beoordeling hangt af van het
                    daadwerkelijke gebruik.
                  </p>

                  <p className="mt-4 leading-relaxed text-[#D7D9DA]">
                    Het bezoeken van Gowtrain, verder
                    navigeren of lezen van dit beleid is
                    geen toestemming voor niet-noodzakelijke
                    tracking. Voor eventuele
                    toestemmingsplichtige technieken is
                    een afzonderlijke keuze nodig.
                  </p>

                  <p className="mt-4 leading-relaxed text-[#D7D9DA]">
                    Er is momenteel geen afzonderlijk
                    cookievoorkeurenpaneel. Browsergegevens
                    verwijderen is bovendien niet hetzelfde
                    als het intrekken van een eerder
                    gegeven toestemming bij een aanbieder.
                  </p>
                </section>

                <section>
                  <p className="font-display text-lg text-[#FF4B3E]">
                    06 / CONTACTFORMULIER
                  </p>

                  <h2 className="mt-3 font-display text-3xl leading-tight text-[#D6FF3F] sm:text-4xl">
                    GEEN LOKAAL OPGESLAGEN CONTACTDOSSIER.
                  </h2>

                  <p className="mt-5 leading-relaxed text-[#D7D9DA]">
                    Onze contactformuliercode bewaart je
                    bericht tijdens het invullen in het
                    geheugen van het scherm. We slaan het
                    bericht niet zelf op in localStorage,
                    sessionStorage of cookies. Je browser
                    kan onafhankelijk daarvan eigen
                    formulier- of automatisch aanvulgedrag
                    hebben.
                  </p>

                  <p className="mt-4 leading-relaxed text-[#D7D9DA]">
                    Na verzending worden gegevens verwerkt
                    door onze server, maildienst en
                    ontvangende mailbox. De server bewaart
                    ook beperkte technische metadata om
                    verzendpogingen te begrenzen en
                    dubbele verwerking te voorkomen.
                    Dat is geen browsercookie. Meer
                    informatie staat in onze privacyverklaring.
                  </p>
                </section>

                <section>
                  <p className="font-display text-lg text-[#FF4B3E]">
                    07 / MOBIELE APP
                  </p>

                  <h2 className="mt-3 font-display text-3xl leading-tight text-[#D6FF3F] sm:text-4xl">
                    OPSLAG OP JE TELEFOON.
                  </h2>

                  <p className="mt-5 leading-relaxed text-[#D7D9DA]">
                    De mobiele app gebruikt voor bepaalde
                    functies apparaatopslag in plaats van
                    gewone browsercookies. Voorbeelden zijn
                    je themavoorkeur en bewaarde statusbewijzen
                    voor accountverwijdering. De gebruikte
                    opslag verschilt per functie en platform.
                  </p>

                  <p className="mt-4 leading-relaxed text-[#D7D9DA]">
                    Een statusbewijs voor accountverwijdering
                    kan bewust bewaard blijven nadat je
                    uitlogt, zodat je een lopend verzoek
                    nog kunt volgen. Het wissen van
                    appgegevens kan die toegang verloren
                    laten gaan.
                  </p>

                  <p className="mt-4 leading-relaxed text-[#D7D9DA]">
                    Open je vanuit de app een website of
                    externe betaalpagina, dan gelden
                    daarnaast de opslagtechnieken van die
                    webomgeving. Appopslag en browseropslag
                    zijn niet altijd dezelfde gegevens.
                  </p>
                </section>

                <section>
                  <p className="font-display text-lg text-[#FF4B3E]">
                    08 / ZELF BEHEREN
                  </p>

                  <h2 className="mt-3 font-display text-3xl leading-tight text-[#D6FF3F] sm:text-4xl">
                    WEBSITEGEGEVENS VERWIJDEREN.
                  </h2>

                  <p className="mt-5 leading-relaxed text-[#D7D9DA]">
                    Via je browserinstellingen kun je
                    cookies en andere websitegegevens
                    bekijken, blokkeren of verwijderen.
                    Controleer of je browser ook lokale
                    opslag wist; alleen cookies verwijderen
                    wist niet in iedere browser alle
                    websitegegevens.
                  </p>

                  <p className="mt-4 leading-relaxed text-[#D7D9DA]">
                    Hierdoor kun je uitgelogd raken,
                    voorkeuren verliezen of functies niet
                    meer kunnen gebruiken. Het verwijderen
                    van gegevens op je apparaat verwijdert
                    niet automatisch je account, boekingen
                    of gegevens bij Gowtrain en zijn
                    dienstverleners.
                  </p>

                  <div className="mt-6 grid gap-3 sm:grid-cols-2">
                    <a
                      href="https://support.google.com/chrome/answer/95647"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="border-2 border-white/20 px-5 py-4 font-display text-base text-white transition hover:border-[#D6FF3F] hover:text-[#D6FF3F]"
                    >
                      GOOGLE CHROME →
                    </a>

                    <a
                      href="https://support.mozilla.org/nl/kb/cookies-en-websitegegevens-wissen-firefox"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="border-2 border-white/20 px-5 py-4 font-display text-base text-white transition hover:border-[#D6FF3F] hover:text-[#D6FF3F]"
                    >
                      MOZILLA FIREFOX →
                    </a>

                    <a
                      href="https://support.apple.com/nl-nl/guide/safari/sfri11471/mac"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="border-2 border-white/20 px-5 py-4 font-display text-base text-white transition hover:border-[#D6FF3F] hover:text-[#D6FF3F]"
                    >
                      SAFARI →
                    </a>

                    <a
                      href="https://support.microsoft.com/nl-nl/microsoft-edge"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="border-2 border-white/20 px-5 py-4 font-display text-base text-white transition hover:border-[#D6FF3F] hover:text-[#D6FF3F]"
                    >
                      MICROSOFT EDGE →
                    </a>
                  </div>
                </section>

                <section className="border-t-2 border-white/20 pt-8">
                  <h2 className="font-display text-3xl text-[#D6FF3F]">
                    PRIVACY EN CONTACT.
                  </h2>

                  <p className="mt-4 leading-relaxed text-[#B9BEC2]">
                    Lees voor de verwerking van
                    persoonsgegevens, je rechten en
                    bewaartermijnen onze{" "}
                    <Link
                      href="/privacy"
                      className="text-[#D6FF3F] underline underline-offset-4 hover:text-white"
                    >
                      privacyverklaring
                    </Link>
                    .
                  </p>

                  <p className="mt-4 leading-relaxed text-[#B9BEC2]">
                    Heb je vragen over cookies of lokale
                    opslag? Gebruik het{" "}
                    <Link
                      href="/support"
                      className="text-[#D6FF3F] underline underline-offset-4 hover:text-white"
                    >
                      contactformulier
                    </Link>
                    . Je hoeft hiervoor niet ingelogd te zijn.
                  </p>

                  <p className="mt-4 leading-relaxed text-[#B9BEC2]">
                    We passen dit beleid aan wanneer het
                    gebruik van opslagtechnieken verandert.
                    De wijzigingsdatum staat bovenaan deze
                    pagina.
                  </p>
                </section>
              </div>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}