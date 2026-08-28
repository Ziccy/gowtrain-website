import Link from "next/link";
import SiteFooter from "@/components/SiteFooter";

const lastUpdated = "24 augustus 2026";

export default function VoorwaardenPage() {
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
          TERMS
        </div>

        <div className="relative mx-auto max-w-5xl px-5 sm:px-8">
          {/* Intro */}
          <div className="border-b-2 border-white/20 pb-8">
            <p className="font-display text-lg text-[#FF4B3E]">
              GOWTRAIN · JURIDISCH
            </p>

            <h1 className="mt-3 font-display text-6xl leading-[0.83] sm:text-7xl lg:text-8xl">
              ALGEMENE
              <br />
              VOORWAARDEN.
            </h1>

            <p className="mt-7 max-w-3xl text-lg leading-relaxed text-[#D7D9DA] sm:text-xl">
              Duidelijke afspraken voor spelers, trainers en GowTrain. Zo weet
              iedereen waar hij of zij aan toe is. Geen omwegen. Wel de baan
              op.
            </p>

            <p className="mt-5 font-display text-sm text-[#D6FF3F]">
              LAATST BIJGEWERKT: {lastUpdated.toUpperCase()}
            </p>
          </div>

          {/* Terms */}
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
                    GowTrain is een online platform waarop spelers
                    padel- en tennistrainers kunnen vinden, bekijken en een
                    training kunnen aanvragen. Trainers kunnen via GowTrain hun
                    profiel, beschikbaarheid en boekingsaanvragen beheren.
                  </p>

                  <div className="mt-6 border-l-2 border-[#D6FF3F] pl-5 text-sm leading-relaxed text-[#B9BEC2]">
                    <p>
                      <strong className="text-white">Onderneming:</strong>{" "}
                      GowTrain [volledige bedrijfsnaam]
                    </p>
                    <p className="mt-1">
                      <strong className="text-white">Adres:</strong>{" "}
                      [vestigingsadres]
                    </p>
                    <p className="mt-1">
                      <strong className="text-white">KVK-nummer:</strong>{" "}
                      [KVK-nummer]
                    </p>
                    <p className="mt-1">
                      <strong className="text-white">Contact:</strong>{" "}
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
                    02 / DEFINITIES
                  </p>

                  <h2 className="mt-3 font-display text-4xl leading-[0.85] text-[#D6FF3F] sm:text-5xl">
                    WIE DOET WAT?
                  </h2>

                  <div className="mt-6 space-y-4">
                    <div className="border-l-2 border-[#D6FF3F] pl-5">
                      <p className="font-display text-lg text-white">
                        GOWTRAIN
                      </p>
                      <p className="mt-2 text-sm leading-relaxed text-[#B9BEC2]">
                        Het digitale platform en de dienstverlening van
                        GowTrain.
                      </p>
                    </div>

                    <div className="border-l-2 border-[#FF4B3E] pl-5">
                      <p className="font-display text-lg text-white">
                        SPELER
                      </p>
                      <p className="mt-2 text-sm leading-relaxed text-[#B9BEC2]">
                        Een persoon die via GowTrain trainers zoekt,
                        trainingsmomenten bekijkt of een boekingsaanvraag doet.
                      </p>
                    </div>

                    <div className="border-l-2 border-white pl-5">
                      <p className="font-display text-lg text-white">
                        TRAINER
                      </p>
                      <p className="mt-2 text-sm leading-relaxed text-[#B9BEC2]">
                        Een zelfstandige of clubgebonden trainer die via
                        GowTrain een profiel en beschikbaarheid aanbiedt.
                      </p>
                    </div>

                    <div className="border-l-2 border-[#D6FF3F] pl-5">
                      <p className="font-display text-lg text-white">
                        BOEKINGSAANVRAAG
                      </p>
                      <p className="mt-2 text-sm leading-relaxed text-[#B9BEC2]">
                        Een verzoek van een speler aan een trainer voor een
                        specifiek trainingsmoment.
                      </p>
                    </div>
                  </div>
                </section>

                <section>
                  <p className="font-display text-lg text-[#FF4B3E]">
                    03 / HET PLATFORM
                  </p>

                  <h2 className="mt-3 font-display text-4xl leading-[0.85] text-[#D6FF3F] sm:text-5xl">
                    GOWTRAIN BRENGT SAMEN.
                  </h2>

                  <p className="mt-5 leading-relaxed text-[#D7D9DA]">
                    GowTrain faciliteert het vinden van trainers, het tonen van
                    trainerprofielen en beschikbaarheid, en het versturen en
                    beheren van boekingsaanvragen.
                  </p>

                  <div className="mt-6 border-2 border-white/20 p-5">
                    <p className="font-display text-xl text-white">
                      GOWTRAIN IS GEEN TRAINER.
                    </p>

                    <p className="mt-3 text-sm leading-relaxed text-[#B9BEC2]">
                      De trainingsovereenkomst komt, zodra een
                      boekingsaanvraag is bevestigd, in beginsel tot stand
                      tussen de speler en de trainer. GowTrain is daarbij
                      platformaanbieder en geen uitvoerder van de training.
                    </p>
                  </div>

                  <p className="mt-5 leading-relaxed text-[#D7D9DA]">
                    GowTrain streeft naar een betrouwbaar platform, maar
                    garandeert niet dat een trainer altijd beschikbaar is, dat
                    ieder profiel volledig foutloos is of dat een training
                    uiteindelijk kan doorgaan.
                  </p>
                </section>

                <section>
                  <p className="font-display text-lg text-[#FF4B3E]">
                    04 / SPELERACCOUNT
                  </p>

                  <h2 className="mt-3 font-display text-4xl leading-[0.85] text-[#D6FF3F] sm:text-5xl">
                    JOUW ACCOUNT.
                  </h2>

                  <ul className="mt-5 space-y-3 text-sm leading-relaxed text-[#B9BEC2]">
                    <li>
                      • Je verstrekt bij registratie correcte, actuele en
                      volledige gegevens.
                    </li>
                    <li>
                      • Je bent zelf verantwoordelijk voor het veilig bewaren
                      van je inloggegevens.
                    </li>
                    <li>
                      • Je gebruikt GowTrain niet voor misleiding, fraude,
                      ongewenste communicatie of andere onrechtmatige
                      doeleinden.
                    </li>
                    <li>
                      • Je mag niet namens een andere persoon een account
                      gebruiken zonder toestemming.
                    </li>
                    <li>
                      • Je kunt contact opnemen met GowTrain als je je account
                      wilt laten verwijderen, voor zover wettelijke
                      bewaarplichten dat toelaten.
                    </li>
                  </ul>
                </section>

                <section>
                  <p className="font-display text-lg text-[#FF4B3E]">
                    05 / TRAINERACCOUNT
                  </p>

                  <h2 className="mt-3 font-display text-4xl leading-[0.85] text-[#D6FF3F] sm:text-5xl">
                    JOUW PROFIEL. JOUW VERANTWOORDELIJKHEID.
                  </h2>

                  <p className="mt-5 leading-relaxed text-[#D7D9DA]">
                    Een trainer meldt zich aan via GowTrain en kan pas
                    zichtbaar worden voor spelers nadat GowTrain het profiel
                    heeft goedgekeurd en geactiveerd.
                  </p>

                  <ul className="mt-5 space-y-3 text-sm leading-relaxed text-[#B9BEC2]">
                    <li>
                      • De trainer zorgt dat profielinformatie, specialisaties,
                      tarieven en beschikbaarheid correct zijn.
                    </li>
                    <li>
                      • De trainer is verantwoordelijk voor de kwaliteit,
                      veiligheid en uitvoering van de aangeboden training.
                    </li>
                    <li>
                      • De trainer zorgt zelf voor eventuele benodigde
                      bevoegdheden, verzekeringen, vergunningen en fiscale
                      verplichtingen.
                    </li>
                    <li>
                      • De trainer reageert binnen een redelijke termijn op
                      boekingsaanvragen.
                    </li>
                    <li>
                      • De trainer gebruikt contactgegevens van spelers alleen
                      voor de relevante boeking en training.
                    </li>
                    <li>
                      • GowTrain mag een trainerprofiel goedkeuren, afkeuren,
                      tijdelijk deactiveren of verwijderen wanneer daar een
                      redelijke aanleiding voor is.
                    </li>
                  </ul>
                </section>

                <section>
                  <p className="font-display text-lg text-[#FF4B3E]">
                    06 / BOEKINGSAANVRAGEN
                  </p>

                  <h2 className="mt-3 font-display text-4xl leading-[0.85] text-[#D6FF3F] sm:text-5xl">
                    AANVRAGEN. BEVESTIGEN. GOW!
                  </h2>

                  <p className="mt-5 leading-relaxed text-[#D7D9DA]">
                    Een speler kiest via GowTrain een beschikbaar moment en
                    verstuurt een boekingsaanvraag. De trainer ontvangt deze
                    aanvraag en kan deze accepteren of afwijzen.
                  </p>

                  <div className="mt-6 grid gap-4 md:grid-cols-3">
                    <div className="border-2 border-white/20 p-5">
                      <p className="font-display text-2xl text-[#D6FF3F]">
                        01
                      </p>
                      <p className="mt-3 font-display text-lg text-white">
                        AANVRAAG
                      </p>
                      <p className="mt-2 text-sm leading-relaxed text-[#B9BEC2]">
                        De speler kiest een moment en verstuurt een aanvraag.
                      </p>
                    </div>

                    <div className="border-2 border-white/20 p-5">
                      <p className="font-display text-2xl text-[#D6FF3F]">
                        02
                      </p>
                      <p className="mt-3 font-display text-lg text-white">
                        REACTIE TRAINER
                      </p>
                      <p className="mt-2 text-sm leading-relaxed text-[#B9BEC2]">
                        De trainer accepteert of wijst de aanvraag af.
                      </p>
                    </div>

                    <div className="border-2 border-white/20 p-5">
                      <p className="font-display text-2xl text-[#D6FF3F]">
                        03
                      </p>
                      <p className="mt-3 font-display text-lg text-white">
                        BEVESTIGD
                      </p>
                      <p className="mt-2 text-sm leading-relaxed text-[#B9BEC2]">
                        Na acceptatie is het trainingsmoment bevestigd.
                      </p>
                    </div>
                  </div>

                  <p className="mt-6 leading-relaxed text-[#D7D9DA]">
                    Een aanvraag is geen definitieve bevestiging. Een
                    trainingsmoment is pas bevestigd nadat de trainer de
                    aanvraag via GowTrain heeft geaccepteerd.
                  </p>
                </section>

                <section>
                  <p className="font-display text-lg text-[#FF4B3E]">
                    07 / TARIEVEN EN BETALING
                  </p>

                  <h2 className="mt-3 font-display text-4xl leading-[0.85] text-[#D6FF3F] sm:text-5xl">
                    DUIDELIJK OVER PRIJS.
                  </h2>

                  <p className="mt-5 leading-relaxed text-[#D7D9DA]">
                    Trainers bepalen in beginsel zelf hun tarieven. GowTrain
                    toont de prijs die bij een trainer of specifiek tijdslot is
                    vermeld.
                  </p>

                  <div className="mt-6 border-l-2 border-[#D6FF3F] pl-5">
                    <p className="font-display text-lg text-white">
                      HUIDIGE PLATFORMFASE
                    </p>

                    <p className="mt-2 text-sm leading-relaxed text-[#B9BEC2]">
                      In deze versie van GowTrain kan betaling buiten het
                      platform plaatsvinden, tenzij bij een boeking nadrukkelijk
                      anders wordt vermeld. Afspraken over betaling worden dan
                      tussen speler en trainer gemaakt.
                    </p>
                  </div>

                  <p className="mt-5 leading-relaxed text-[#D7D9DA]">
                    Wanneer GowTrain later betalingen via het platform
                    faciliteert, kunnen aanvullende betalingsvoorwaarden,
                    transactiekosten, annuleringsvoorwaarden of voorwaarden van
                    een betaaldienstverlener gelden.
                  </p>
                </section>

                <section>
                  <p className="font-display text-lg text-[#FF4B3E]">
                    08 / ANNULEREN EN WIJZIGEN
                  </p>

                  <h2 className="mt-3 font-display text-4xl leading-[0.85] text-[#D6FF3F] sm:text-5xl">
                    KAN GEBEUREN. MELD HET OP TIJD.
                  </h2>

                  <p className="mt-5 leading-relaxed text-[#D7D9DA]">
                    Kan een speler of trainer niet op een bevestigd moment?
                    Neem dan zo snel mogelijk contact op met de andere partij.
                    De trainer en speler maken onderling afspraken over een
                    vervangend moment, annulering en eventuele kosten.
                  </p>

                  <p className="mt-4 leading-relaxed text-[#D7D9DA]">
                    GowTrain kan op termijn een standaard
                    annuleringsbeleid aanbieden. Totdat dat beleid actief is,
                    zijn de afspraken van de trainer en speler leidend, voor
                    zover deze redelijk en wettelijk toegestaan zijn.
                  </p>
                </section>

                <section>
                  <p className="font-display text-lg text-[#FF4B3E]">
                    09 / GEDRAG EN VEILIGHEID
                  </p>

                  <h2 className="mt-3 font-display text-4xl leading-[0.85] text-[#D6FF3F] sm:text-5xl">
                    RESPECT OP EN NAAST DE BAAN.
                  </h2>

                  <p className="mt-5 leading-relaxed text-[#D7D9DA]">
                    Iedereen die GowTrain gebruikt, gaat respectvol, eerlijk en
                    veilig met anderen om. Intimidatie, discriminatie,
                    bedreiging, fraude, spam, misleiding en ander ongewenst of
                    onrechtmatig gedrag zijn niet toegestaan.
                  </p>

                  <p className="mt-4 leading-relaxed text-[#D7D9DA]">
                    Bij signalen van misbruik of onveilig gedrag mag GowTrain
                    accounts, profielen, beschikbaarheid of boekingen tijdelijk
                    beperken, onderzoeken, opschorten of verwijderen.
                  </p>
                </section>

                <section>
                  <p className="font-display text-lg text-[#FF4B3E]">
                    10 / AANSPRAKELIJKHEID
                  </p>

                  <h2 className="mt-3 font-display text-4xl leading-[0.85] text-[#D6FF3F] sm:text-5xl">
                    DUIDELIJK OVER ROLLEN.
                  </h2>

                  <p className="mt-5 leading-relaxed text-[#D7D9DA]">
                    GowTrain faciliteert de verbinding tussen spelers en
                    trainers. GowTrain is niet verantwoordelijk voor de inhoud,
                    kwaliteit, veiligheid, uitvoering of uitkomst van een
                    training die door een trainer wordt gegeven.
                  </p>

                  <p className="mt-4 leading-relaxed text-[#D7D9DA]">
                    De trainer is verantwoordelijk voor zijn of haar
                    dienstverlening. De speler is verantwoordelijk voor het
                    juist inschatten van eigen fysieke mogelijkheden en het
                    opvolgen van redelijke instructies van de trainer.
                  </p>

                  <p className="mt-4 leading-relaxed text-[#D7D9DA]">
                    Voor zover wettelijk toegestaan, is de aansprakelijkheid van
                    GowTrain beperkt tot directe schade die het gevolg is van
                    opzet of bewuste roekeloosheid van GowTrain. Deze beperking
                    geldt niet wanneer de wet een beperking van
                    aansprakelijkheid niet toestaat.
                  </p>
                </section>

                <section>
                  <p className="font-display text-lg text-[#FF4B3E]">
                    11 / INTELLECTUEEL EIGENDOM
                  </p>

                  <h2 className="mt-3 font-display text-4xl leading-[0.85] text-[#D6FF3F] sm:text-5xl">
                    GOWTRAIN BLIJFT GOWTRAIN.
                  </h2>

                  <p className="mt-5 leading-relaxed text-[#D7D9DA]">
                    Alle rechten op de naam GowTrain, het logo, de huisstijl,
                    software, teksten, ontwerpen en overige inhoud van het
                    platform behoren toe aan GowTrain of aan de betreffende
                    rechthebbenden.
                  </p>

                  <p className="mt-4 leading-relaxed text-[#D7D9DA]">
                    Je mag deze onderdelen niet zonder voorafgaande
                    toestemming kopiëren, verspreiden, wijzigen of commercieel
                    gebruiken.
                  </p>
                </section>

                <section>
                  <p className="font-display text-lg text-[#FF4B3E]">
                    12 / PRIVACY
                  </p>

                  <h2 className="mt-3 font-display text-4xl leading-[0.85] text-[#D6FF3F] sm:text-5xl">
                    JOUW DATA.
                  </h2>

                  <p className="mt-5 leading-relaxed text-[#D7D9DA]">
                    Op de verwerking van persoonsgegevens is onze{" "}
                    <Link
                      href="/privacy"
                      className="font-semibold text-[#D6FF3F] underline underline-offset-4 hover:text-white"
                    >
                      privacyverklaring
                    </Link>{" "}
                    van toepassing.
                  </p>
                </section>

                <section>
                  <p className="font-display text-lg text-[#FF4B3E]">
                    13 / WIJZIGINGEN
                  </p>

                  <h2 className="mt-3 font-display text-4xl leading-[0.85] text-[#D6FF3F] sm:text-5xl">
                    ALS GOWTRAIN GROEIT.
                  </h2>

                  <p className="mt-5 leading-relaxed text-[#D7D9DA]">
                    GowTrain mag deze algemene voorwaarden wijzigen wanneer dat
                    nodig is door ontwikkelingen in het platform, de
                    dienstverlening of wet- en regelgeving. De meest actuele
                    versie staat altijd op deze pagina.
                  </p>
                </section>

                <section>
                  <p className="font-display text-lg text-[#FF4B3E]">
                    14 / TOEPASSELIJK RECHT
                  </p>

                  <h2 className="mt-3 font-display text-4xl leading-[0.85] text-[#D6FF3F] sm:text-5xl">
                    NEDERLANDS RECHT.
                  </h2>

                  <p className="mt-5 leading-relaxed text-[#D7D9DA]">
                    Op deze algemene voorwaarden en het gebruik van GowTrain is
                    Nederlands recht van toepassing, tenzij dwingend recht
                    anders bepaalt.
                  </p>
                </section>

                <section className="border-t-2 border-white/20 pt-8">
                  <p className="font-display text-3xl text-[#D6FF3F]">
                    VRAGEN?
                  </p>

                  <p className="mt-4 max-w-3xl leading-relaxed text-[#B9BEC2]">
                    Heb je vragen over deze voorwaarden? Mail ons via{" "}
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