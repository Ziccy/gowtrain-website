import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";

const lastUpdated = "27 september 2026";

/*
 * CONCEPT
 *
 * Pas op false zetten na invulling van de bedrijfsgegevens,
 * afstemming met de daadwerkelijke boekings-/annuleringscode
 * en juridische controle.
 */
const isDraft = true;

const organisation = {
  legalName: "[VOLLEDIGE BEDRIJFSNAAM]",
  address: "[VESTIGINGS- EN CONTACTADRES]",
  chamberOfCommerce: "[KVK-NUMMER]",
};

const sections = [
  {
    number: "02",
    title: "WIE DOET WAT?",
    paragraphs: [
      "Gowtrain biedt een website en app waarmee spelers trainers kunnen vinden en trainingen kunnen boeken. Trainers beheren via het platform hun profiel, lesaanbod en boekingen.",
      "De trainingsovereenkomst komt tot stand tussen de speler en de trainer die de training aanbiedt, handelend voor zichzelf of vanuit diens eigen onderneming. Een club is binnen dit platformmodel niet de contractpartij voor de training. De identiteit van de aanbieder moet vóór de boeking duidelijk zijn.",
      "Gowtrain levert de platformdienst en faciliteert de betaling via Stripe. Gowtrain geeft de training niet zelf. Dit onderscheid neemt de verantwoordelijkheid van Gowtrain voor zijn eigen dienstverlening niet weg.",
    ],
  },
  {
    number: "03",
    title: "JE ACCOUNT EN HET GEBRUIK.",
    paragraphs: [
      "Gebruik correcte en actuele accountgegevens en houd je inloggegevens vertrouwelijk. Neem contact met ons op als je vermoedt dat iemand onbevoegd toegang tot je account heeft.",
      "Gebruik Gowtrain niet voor fraude, misleiding, spam, ongeoorloofde toegang of andere onrechtmatige activiteiten. Gebruik geen account van iemand anders zonder geldige bevoegdheid.",
      "Behandel andere gebruikers respectvol. Intimidatie, discriminatie, bedreiging en onveilig gedrag zijn niet toegestaan.",
      "Voor een boeking met meerdere deelnemers moet de boeker bevoegd zijn de betreffende afspraken te maken. Als toestemming of vertegenwoordiging van een ouder of wettelijke vertegenwoordiger nodig is, moet die aanwezig zijn.",
    ],
  },
  {
    number: "04",
    title: "VERANTWOORDELIJKHEDEN VAN DE TRAINER.",
    paragraphs: [
      "Een trainerprofiel wordt pas voor spelers gepubliceerd nadat het is goedgekeurd en geactiveerd. Goedkeuring door Gowtrain is geen garantie voor een bepaald trainingsresultaat en mag niet worden opgevat als een certificering die Gowtrain niet daadwerkelijk heeft uitgevoerd.",
      "De trainer houdt profielinformatie, tarieven, locaties, beschikbaarheid en pakketgegevens correct en actueel. Door beschikbare trainingen aan te bieden, moet de trainer rekening houden met directe boekingen zonder een afzonderlijke acceptatiestap.",
      "De trainer is verantwoordelijk voor de professionele, veilige en zorgvuldige uitvoering van de training en voor de daarvoor benodigde baan of locatie. Baanhuur is inbegrepen in de aangeboden trainingsprijs.",
      "De trainer zorgt voor de bevoegdheden, verzekeringen en overige voorzieningen die voor diens werkzaamheden vereist zijn, en voldoet aan de eigen fiscale en administratieve verplichtingen.",
      "De trainer gebruikt gegevens van spelers alleen voor rechtmatige doelen die bij de training, boeking en noodzakelijke administratie horen. Voor ander gebruik is een afzonderlijke geldige grondslag nodig.",
    ],
  },
  {
    number: "05",
    title: "KIEZEN. BETALEN. BEVESTIGD.",
    paragraphs: [
      "Je kiest een beschikbare losse les of een aangeboden lespakket. Controleer vóór betalen de trainer, locatie, sport, lestijden, het aantal deelnemers, de totale prijs en de toepasselijke annuleringsregels.",
      "Bij een lespakket boek je de bij dat aanbod vermelde lessen als één pakket. De getoonde pakketgegevens bepalen welke trainingsmomenten bij de aankoop horen.",
      "De huidige boekingsflow bevestigt de boeking nadat de betaling succesvol is verwerkt en de boeking door het platform is bevestigd. De trainer hoeft de betaalde boeking niet nog afzonderlijk te accepteren.",
      "Alleen een betaalscherm openen of een betaling starten is geen bevestiging. Een vertraagd scherm of ontbrekende e-mail bewijst omgekeerd niet dat de betaling is mislukt. Controleer bij twijfel eerst je boeking en neem contact op voordat je opnieuw betaalt.",
      "De bevestigde boekingsgegevens zijn leidend voor de gemaakte afspraak. Wijzigingen van het aanbod achteraf veranderen niet automatisch de voorwaarden of prijs van een bestaande boeking.",
    ],
  },
  {
    number: "06",
    title: "PRIJS EN BETALING.",
    paragraphs: [
      "De trainer bepaalt de aangeboden trainingsprijs. Baanhuur is daarbij inbegrepen. Vóór de definitieve boeking moet duidelijk zijn welk totaalbedrag de speler betaalt, inclusief toepasselijke belastingen en eventuele vooraf uitdrukkelijk vermelde kosten.",
      "Betalingen voor de huidige boekingsflow verlopen via Stripe. Welke betaalmethoden beschikbaar zijn, zie je in het betaalscherm. Voor onderdelen van de betaaldienst kunnen ook voorwaarden van Stripe of de gekozen betaaldienstverlener gelden.",
      "Gowtrain houdt 5% commissie in op het boekingsbedrag. De Stripe-betaalkosten komen voor rekening van Gowtrain en worden niet daarnaast als Stripe-kosten op de trainer verhaald.",
      "Deze afspraken vormen geen toestemming om achteraf onverwachte baanhuur of andere niet overeengekomen kosten aan de speler in rekening te brengen.",
    ],
  },
  {
    number: "07",
    title: "ANNULEREN DOOR DE SPELER.",
    paragraphs: [
      "Gebruik voor een annulering de daarvoor beschikbare functie bij je boeking. Is die niet beschikbaar of kun je niet meer inloggen, neem dan direct contact op met Gowtrain. Bewaar de bevestiging van je annulering of contactverzoek.",
      "Voor een losse les geldt een termijn van 24 uur vóór de oorspronkelijke starttijd. Bij tijdige annulering volgt volledige terugbetaling van het lesbedrag. Bij annulering binnen die termijn volgt volgens het standaardbeleid geen automatische terugbetaling.",
      "Voor annulering van een volledig lespakket geldt een termijn van 48 uur vóór de oorspronkelijke starttijd van de eerste les. Bij tijdige annulering wordt het volledige pakket geannuleerd en terugbetaald. Bij annulering binnen die termijn volgt volgens het standaardbeleid geen automatische terugbetaling van het pakket.",
      "De regel voor het volledige pakket betekent niet automatisch dat iedere pakketles afzonderlijk door de speler kan worden geannuleerd of terugbetaald. De mogelijkheid en voorwaarden daarvoor moeten afzonderlijk duidelijk zijn.",
      "Een mededeling aan de trainer is niet op zichzelf een bevestiging dat een annulering of terugbetaling in het platform is verwerkt. Neem bij twijfel contact op met Gowtrain.",
      "Het ontbreken van een automatische terugbetaling sluit een afzonderlijke beoordeling of een wettelijk recht op terugbetaling niet uit.",
    ],
  },
  {
    number: "08",
    title: "ANNULEREN DOOR DE TRAINER EN SLECHT WEER.",
    paragraphs: [
      "Kan de trainer een geboekte les niet uitvoeren, dan moet de trainer de speler zo snel mogelijk informeren en de annulering via de beschikbare platformfunctie laten verwerken.",
      "Bij annulering van een les door de trainer wordt het volledige bedrag van die les terugbetaald. Betreft het één les uit een pakket, dan betreft de annulering en terugbetaling die les en niet automatisch het volledige pakket.",
      "Voor een door de trainer geannuleerde les is geen trainersdeel verschuldigd.",
      "Bij slecht weer stemmen speler en trainer af of de les veilig en verantwoord kan doorgaan en of een alternatief mogelijk is. Een andere datum of locatie wordt niet eenzijdig opgelegd: leg een overeengekomen wijziging duidelijk vast.",
      "Een afspraak over slecht weer wijzigt niet automatisch de boekings- of betaalstatus in Gowtrain. Is een wijziging of annulering niet correct via het platform uit te voeren, neem dan contact op met Gowtrain voor afhandeling.",
      "Deze overlegafspraak betekent niet dat de speler automatisch alle kosten draagt als de training niet kan worden geleverd. Toepasselijke wettelijke rechten blijven gelden.",
    ],
  },
  {
    number: "09",
    title: "TERUGBETALINGEN EN TRAINERSDEEL.",
    paragraphs: [
      "Een geregistreerde terugbetalingsopdracht is nog geen bevestiging dat het bedrag al is teruggestort. Terugbetalingen worden via de betaaldienst verwerkt, in beginsel naar de oorspronkelijke betaalmethode. Wanneer het bedrag zichtbaar is, hangt mede af van de bank en betaalmethode.",
      "De vrijgave van het trainersdeel vindt in beginsel plaats vanaf 24 uur na de start van de betreffende les. Bij een pakket wordt dit per les afgehandeld. Een openstaande klacht, terugbetaling, onzekere betaalstatus of andere relevante blokkade kan vrijgave tegenhouden.",
      "Een vrijgave of Stripe-transfer is niet hetzelfde als een bijschrijving op de bankrekening van de trainer. De bankuitbetaling hangt daarnaast af van de Stripe-accountstatus, het uitbetalingsschema en de verwerking door de bank.",
      "Bij een late spelersannulering zonder terugbetaling blijft het trainersdeel volgens het annuleringsbeleid in beginsel verschuldigd. Een afzonderlijk rechtmatig besluit over een klacht of terugbetaling kan tot andere afhandeling leiden.",
      "Een onzekere betaal- of refunduitkomst wordt eerst onderzocht. Het opnieuw indienen van dezelfde betaling of terugbetaling is niet automatisch een veilige oplossing.",
    ],
  },
  {
    number: "10",
    title: "KLACHTEN EN PROBLEMEN.",
    paragraphs: [
      "Meld een probleem met een training of boeking zo snel mogelijk via de beschikbare meldingsfunctie of via Contact. Vermeld voldoende informatie om de boeking te vinden, maar stuur geen wachtwoorden, volledige betaalgegevens of identiteitsdocumenten mee.",
      "We onderzoeken het probleem en kunnen informatie vragen aan de betrokken partijen. Het indienen van een klacht is op zichzelf geen vaststelling van schuld en geeft niet automatisch recht op een terugbetaling.",
      "Een besluit tot terugbetaling en de daadwerkelijke uitvoering daarvan zijn afzonderlijke stappen. We maken dat onderscheid in de communicatie over de afhandeling.",
      "Een beoordeling door Gowtrain neemt wettelijke rechten of de mogelijkheid om het geschil aan een bevoegde rechter voor te leggen niet weg.",
    ],
  },
  {
    number: "11",
    title: "ANNULERINGSBELEID EN WETTELIJKE RECHTEN.",
    paragraphs: [
      "Ons annuleringsbeleid staat los van een eventueel wettelijk herroepingsrecht. Voor vrijetijdsdiensten op een bepaalde datum of in een bepaalde periode kan een wettelijke uitzondering op het herroepingsrecht gelden.",
      "Die uitzondering geldt niet zonder beoordeling voor iedere dienst of overeenkomst via Gowtrain. Welke wettelijke informatie en rechten gelden, moet vóór het sluiten van de betreffende overeenkomst duidelijk worden gemaakt.",
      "Deze voorwaarden beperken geen dwingende consumentenrechten, waaronder rechten die kunnen gelden als een overeengekomen dienst niet of niet behoorlijk wordt uitgevoerd.",
    ],
  },
  {
    number: "12",
    title: "VEILIGHEID EN AANSPRAKELIJKHEID.",
    paragraphs: [
      "De trainer is verantwoordelijk voor de training die deze aanbiedt en uitvoert. De speler houdt rekening met de eigen fysieke mogelijkheden en volgt redelijke veiligheidsinstructies op. Dit ontslaat de trainer niet van diens zorgplicht.",
      "Gowtrain is verantwoordelijk voor zijn eigen verplichtingen als platformaanbieder. De rol als tussenpersoon is geen algemene uitsluiting van aansprakelijkheid voor eigen tekortkomingen of onrechtmatig handelen.",
      "Of en in welke omvang iemand aansprakelijk is, wordt bepaald door de toepasselijke wet en de omstandigheden. Deze conceptvoorwaarden bevatten geen algemene uitsluiting van aansprakelijkheid voor gewone fouten van Gowtrain.",
      "Gowtrain streeft naar een beschikbaar en betrouwbaar platform, maar kan niet garanderen dat de website, app of diensten van derden altijd zonder storing werken. Een storing verandert niet automatisch bestaande boekingen of betaalverplichtingen.",
    ],
  },
  {
    number: "13",
    title: "BEPERKING OF BEËINDIGING VAN EEN ACCOUNT.",
    paragraphs: [
      "Bij een concrete aanleiding, zoals misbruik, fraude of een veiligheidsrisico, kan Gowtrain noodzakelijke en proportionele maatregelen nemen. Daarbij kunnen toegang of aanbod tijdelijk worden beperkt terwijl de situatie wordt onderzocht.",
      "Waar vereist informeren we de betrokken gebruiker over de reden en mogelijkheden om te reageren of bezwaar te maken. Voor zover onmiddellijke maatregelen nodig zijn voor veiligheid of een wettelijke verplichting, kan vooraf informeren niet altijd mogelijk zijn.",
      "Een accountblokkering of beëindiging laat openstaande boekingen, rechtmatige betaalverplichtingen, terugbetalingen en klachten niet vanzelf verdwijnen. Die moeten afzonderlijk worden afgehandeld.",
      "Je kunt via Contact een verzoek tot accountverwijdering indienen. Als de verwijderfunctie beschikbaar is voor jouw account, kun je die ook vanuit Account gebruiken. Sommige gegevens kunnen na accountverwijdering nog nodig zijn voor rechtmatige afhandeling of wettelijke bewaring. De privacyverklaring licht dit verder toe.",
    ],
  },
  {
    number: "14",
    title: "INHOUD EN INTELLECTUELE EIGENDOM.",
    paragraphs: [
      "Rechten op software, vormgeving, teksten, logo’s en andere platformonderdelen behoren toe aan de betreffende rechthebbenden. Het gebruik van Gowtrain draagt die rechten niet aan je over. Wettelijk toegestaan gebruik blijft mogelijk.",
      "Plaats alleen profielteksten, foto’s, berichten en andere inhoud die je rechtmatig mag gebruiken en delen. Inhoud mag geen rechten van anderen schenden.",
      "Voor zover nodig voor het aanbieden van je profiel of het uitvoeren van de platformdienst geef je Gowtrain toestemming die inhoud daarvoor te verwerken en weer te geven. Je draagt daarmee niet automatisch het eigendom van je inhoud over.",
    ],
  },
  {
    number: "15",
    title: "WIJZIGINGEN EN TOEPASSELIJK RECHT.",
    paragraphs: [
      "We kunnen deze voorwaarden wijzigen als daarvoor een geldige aanleiding bestaat, zoals veranderingen in de dienstverlening of wetgeving. Belangrijke wijzigingen worden passend en, waar vereist, vooraf aangekondigd. Waar nodig vragen we instemming of bieden we de wettelijk vereiste mogelijkheid tot beëindiging.",
      "Een nieuwe versie verandert niet automatisch met terugwerkende kracht de prijs of annuleringsafspraken van al bevestigde boekingen. De toepasselijke versie moet voor de betrokken overeenkomst kunnen worden vastgesteld.",
      "Op de dienstverlening van Gowtrain is Nederlands recht van toepassing. Deze rechtskeuze ontneemt consumenten niet de bescherming van dwingende bepalingen die zonder deze keuze op hen van toepassing zouden zijn.",
      "Geschillen kunnen worden voorgelegd aan de rechter die volgens de toepasselijke regels bevoegd is.",
    ],
  },
];

export default function VoorwaardenPage() {
  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      <SiteHeader />

      <section className="relative flex-1 overflow-hidden py-12 sm:py-16 lg:py-20">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 -top-16 select-none font-display text-[15rem] leading-none text-[#D6FF3F] opacity-[0.04] sm:text-[24rem] lg:text-[32rem]"
        >
          TERMS
        </div>

        <div className="relative mx-auto max-w-5xl px-5 sm:px-8">
          <div className="border-b-2 border-white/20 pb-8">
            <p className="font-display text-lg text-[#FF4B3E]">
              GOWTRAIN · AFSPRAKEN
            </p>

            <h1 className="mt-3 font-display text-6xl leading-[0.83] sm:text-7xl lg:text-8xl">
              ALGEMENE
              <br />
              VOORWAARDEN.
            </h1>

            <p className="mt-7 max-w-3xl text-lg leading-relaxed text-[#D7D9DA] sm:text-xl">
              Afspraken over de website en app, trainingen,
              betalingen, annuleringen en ondersteuning.
              Voor spelers, trainers en Gowtrain.
            </p>

            <p className="mt-5 font-display text-sm text-[#D6FF3F]">
              LAATST BIJGEWERKT: {lastUpdated.toUpperCase()}
            </p>
          </div>

          {isDraft && (
            <aside className="mt-8 border-2 border-[#FF4B3E] bg-white/5 p-5">
              <h2 className="font-display text-xl text-[#FF8A80]">
                CONCEPT · NOG NIET DEFINITIEF
              </h2>

              <p className="mt-3 text-sm leading-relaxed text-[#D7D9DA]">
                Deze voorwaarden moeten vóór definitieve publicatie
                worden gecontroleerd en aangevuld. Het platform
                bevindt zich nog in de testfase; de huidige
                Stripe-integratie gebruikt testbetalingen.
              </p>

              <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-[#B9BEC2]">
                <li>
                  Bedrijfsgegevens en identificatie van de
                  aanbiedende trainers invullen en controleren.
                </li>
                <li>
                  De precieze grens bij exact 24 en 48 uur laten
                  aansluiten op de annuleringscode.
                </li>
                <li>
                  Vastleggen of en hoe een speler één afzonderlijke
                  pakketles kan annuleren.
                </li>
                <li>
                  De afhandeling bepalen wanneer overleg over
                  slecht weer niet tot een oplossing leidt.
                </li>
                <li>
                  Commissie, btw, facturatie, terugbetalingen en
                  uitbetalingsvoorwaarden controleren.
                </li>
                <li>
                  Consumentenrecht, toepasselijke platformregels,
                  aansprakelijkheid en het aanbieden en vastleggen
                  van deze voorwaarden juridisch laten beoordelen.
                </li>
              </ul>
            </aside>
          )}

          <div className="mt-10 border-2 border-white bg-white p-3 text-[#14171A] shadow-[8px_8px_0_0_#FF4B3E]">
            <div className="bg-[#14171A] p-5 text-white sm:p-8 lg:p-10">
              <div className="space-y-12">
                <section>
                  <p className="font-display text-lg text-[#FF4B3E]">
                    01 / ONDERNEMING EN CONTACT
                  </p>

                  <h2 className="mt-3 font-display text-3xl leading-tight text-[#D6FF3F] sm:text-4xl">
                    GOWTRAIN.
                  </h2>

                  <p className="mt-5 leading-relaxed text-[#D7D9DA]">
                    Deze voorwaarden beschrijven het gebruik
                    van Gowtrain en de afspraken die bij de
                    platformdienst en de aangeboden trainingen
                    horen. Aanvullende aanbodspecifieke afspraken
                    moeten vóór het boeken duidelijk worden
                    meegedeeld.
                  </p>

                  <div className="mt-6 space-y-2 border-l-2 border-[#D6FF3F] pl-5 text-sm leading-relaxed text-[#B9BEC2]">
                    <p>
                      <strong className="text-white">
                        Onderneming:
                      </strong>{" "}
                      {organisation.legalName}
                    </p>

                    <p>
                      <strong className="text-white">
                        Handelsnaam:
                      </strong>{" "}
                      Gowtrain
                    </p>

                    <p>
                      <strong className="text-white">
                        Adres:
                      </strong>{" "}
                      {organisation.address}
                    </p>

                    <p>
                      <strong className="text-white">
                        KvK-nummer:
                      </strong>{" "}
                      {organisation.chamberOfCommerce}
                    </p>

                    <p>
                      <strong className="text-white">
                        Contact:
                      </strong>{" "}
                      <Link
                        href="/support"
                        className="text-[#D6FF3F] underline underline-offset-4 hover:text-white"
                      >
                        Contactformulier
                      </Link>
                      , ook zonder login bereikbaar.
                    </p>
                  </div>
                </section>

                {sections.map((section) => (
                  <section key={section.number}>
                    <p className="font-display text-lg text-[#FF4B3E]">
                      {section.number} / VOORWAARDEN
                    </p>

                    <h2 className="mt-3 font-display text-3xl leading-tight text-[#D6FF3F] sm:text-4xl">
                      {section.title}
                    </h2>

                    <div className="mt-5 space-y-4">
                      {section.paragraphs.map((paragraph) => (
                        <p
                          key={paragraph}
                          className="leading-relaxed text-[#D7D9DA]"
                        >
                          {paragraph}
                        </p>
                      ))}
                    </div>
                  </section>
                ))}

                <section className="border-t-2 border-white/20 pt-8">
                  <h2 className="font-display text-3xl text-[#D6FF3F]">
                    PRIVACY EN VRAGEN.
                  </h2>

                  <p className="mt-4 leading-relaxed text-[#B9BEC2]">
                    In onze{" "}
                    <Link
                      href="/privacy"
                      className="text-[#D6FF3F] underline underline-offset-4 hover:text-white"
                    >
                      privacyverklaring
                    </Link>{" "}
                    lees je hoe we persoonsgegevens verwerken
                    en welke rechten je hebt.
                  </p>

                  <p className="mt-4 leading-relaxed text-[#B9BEC2]">
                    Heb je vragen over een boeking, deze
                    voorwaarden of je account? Gebruik{" "}
                    <Link
                      href="/support"
                      className="text-[#D6FF3F] underline underline-offset-4 hover:text-white"
                    >
                      Contact
                    </Link>{" "}
                    op de website of in de app.
                  </p>
                </section>
              </div>
            </div>
          </div>

          <div className="mt-10 flex flex-col justify-between gap-5 border-t-2 border-white/20 pt-8 sm:flex-row sm:items-center">
            <p className="font-display text-2xl">
              VRAGEN OVER DE AFSPRAKEN?
            </p>

            <Link
              href="/support"
              className="inline-flex w-fit items-center gap-3 bg-[#FF4B3E] px-6 py-4 font-display text-lg text-white transition hover:bg-[#D6FF3F] hover:!text-[#14171A]"
            >
              NEEM CONTACT OP
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}