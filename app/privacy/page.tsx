import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";

const lastUpdated = "27 september 2026";

/*
 * CONCEPTCONFIGURATIE
 *
 * Vul vóór definitieve publicatie de werkelijke gegevens in.
 * Zet isDraft pas op false nadat ook de inhoudelijke
 * controlepunten zijn afgehandeld.
 *
 * Gebruik voor de verantwoordelijke de werkelijk bestaande
 * persoon of onderneming, niet uitsluitend een toekomstige naam.
 */
const isDraft = true;

const organisation = {
  legalName: "[VOLLEDIGE NAAM VERWERKINGSVERANTWOORDELIJKE]",
  address: "[CONTACT- OF VESTIGINGSADRES]",
  chamberOfCommerce: "[KVK-NUMMER NA INSCHRIJVING]",
  mailboxProvider: "[ACTUELE PROVIDER VAN DE SUPPORTMAILBOX]",
};

const sections = [
  {
    number: "02",
    title: "WELKE GEGEVENS VERWERKEN WE?",
    paragraphs: [
      "Welke gegevens we verwerken, hangt af van hoe je de website en app gebruikt. We verwerken gegevens die je zelf invult, gegevens die bij het gebruik ontstaan en gegevens die nodig zijn voor betalingen en ondersteuning.",
    ],
    items: [
      [
        "Accounts",
        "Naam, e-mailadres, accountrol, verificatiestatus en gegevens die nodig zijn om in te loggen en je account te beveiligen. Wachtwoorden die je voor inloggen of accountbevestiging invoert, worden via onze authenticatiedienst gecontroleerd.",
      ],
      [
        "Trainerprofielen en aanbod",
        "Onder meer naam, profielfoto, profielbeschrijving, sport, specialisaties, werkgebied, tarieven, beschikbaarheid en lespakketten. Gegevens die onderdeel zijn van een gepubliceerd trainerprofiel zijn zichtbaar voor bezoekers en gebruikers.",
      ],
      [
        "Boekingen en communicatie",
        "Gekozen trainingen, betrokken speler en trainer, deelnemersaantal, locatie, lestijden, boekingsstatus, berichten, leesregistraties en eventuele reviews.",
      ],
      [
        "Betalingen en terugbetalingen",
        "Onder meer bedragen, betaalstatussen, betaalreferenties, terugbetalingen en gegevens over traineruitbetalingen en Stripe-koppelingen. Stripe verwerkt daarnaast de gegevens die nodig zijn voor zijn betaaldiensten en eventuele identificatiecontroles.",
      ],
      [
        "Ondersteuning en klachten",
        "Het ingevulde e-mailadres, onderwerp en bericht, onze correspondentie en gegevens die nodig zijn om een vraag, klacht of geschil te behandelen.",
      ],
      [
        "Privacy- en verwijderverzoeken",
        "Het verzoek, de noodzakelijke identiteitscontrole, uitvoerstatussen, opvolgafspraken, technische referenties en registraties van beheer- en herstelacties. Voor de verwijderstatus kunnen we een statusbewijs uitgeven waarvan op de server een hash wordt bewaard.",
      ],
      [
        "Technisch gebruik en beveiliging",
        "Technische gegevens die bij hosting, authenticatie en foutafhandeling ontstaan, zoals IP-adressen, aanvraaggegevens en foutregistraties. Voor begrenzing van het contactformulier bewaren we onder meer een inzendnummer en een met een geheime sleutel gehashte versie van het ingevulde e-mailadres.",
      ],
    ],
  },
  {
    number: "03",
    title: "WAARVOOR EN OP WELKE GRONDSLAG?",
    paragraphs: [
      "We gebruiken persoonsgegevens voor specifieke doelen. De toepasselijke grondslag hangt af van de verwerking en jouw relatie met Gowtrain.",
    ],
    items: [
      [
        "Onze dienstverlening uitvoeren",
        "Voor accountbeheer, trainerprofielen, het aanbieden en boeken van trainingen, betalingen en bijbehorende communicatie verwerken we noodzakelijke gegevens voor het uitvoeren van een overeenkomst of voor stappen op jouw verzoek voorafgaand daaraan.",
      ],
      [
        "Vragen beantwoorden",
        "Vragen over een bestaande of beoogde overeenkomst behandelen we voor de uitvoering of voorbereiding daarvan. Andere gewone contactvragen behandelen we vanuit ons gerechtvaardigde belang om bereikbaar te zijn en ondersteuning te bieden.",
      ],
      [
        "Platform en betrokkenen beschermen",
        "Voor het voorkomen en onderzoeken van misbruik, het beveiligen van accounts, het oplossen van technische fouten en het behandelen of onderbouwen van geschillen kunnen we gegevens verwerken op basis van gerechtvaardigd belang. We wegen daarbij onze belangen af tegen jouw rechten en beperken de verwerking tot wat nodig is.",
      ],
      [
        "Wettelijke verplichtingen nakomen",
        "Waar de wet dit vereist, verwerken of bewaren we gegevens voor bijvoorbeeld administratie en het behandelen van verzoeken over privacyrechten.",
      ],
      [
        "Toestemming",
        "Als een verwerking toestemming vereist, vragen we die afzonderlijk voordat we ermee beginnen. Je kunt gegeven toestemming intrekken. Dat verandert niet de rechtmatigheid van verwerking die vóór het intrekken plaatsvond.",
      ],
    ],
  },
  {
    number: "04",
    title: "MET WIE DELEN WE GEGEVENS?",
    paragraphs: [
      "We delen gegevens met de betrokken trainer of speler voor zover dat nodig is voor de training, boeking, communicatie of afhandeling van een probleem. We publiceren geen volledige boekings- of contactdossiers.",
      "Een trainer kan voor eigen verwerking van noodzakelijke klant- en administratiegegevens zelfstandig verantwoordelijk zijn. Een verwijdering bij Gowtrain verwijdert niet automatisch gegevens die een trainer rechtmatig in een eigen administratie bewaart.",
      "We gebruiken daarnaast dienstverleners voor onze technische dienstverlening. Hun precieze rol hangt af van de dienst: niet iedere leverancier verwerkt alle gegevens uitsluitend namens Gowtrain. Voor verwerking namens ons zijn passende verwerkersafspraken nodig.",
      "We kunnen gegevens delen als een wettelijke verplichting dat vereist of als dat noodzakelijk en rechtmatig is voor het vaststellen, uitoefenen of verdedigen van rechtsvorderingen. Gowtrain verkoopt je persoonsgegevens niet.",
    ],
    items: [
      [
        "Supabase",
        "Voor de database, authenticatie, bestandsopslag en backendfuncties.",
      ],
      [
        "Vercel",
        "Voor hosting van de website en uitvoering van website-serverroutes.",
      ],
      [
        "Resend",
        "Voor verzending van platformmails en berichten uit het contactformulier.",
      ],
      [
        "Stripe",
        "Voor betalingen, terugbetalingen en de aansluiting en uitbetalingen van trainers. Stripe kan voor onderdelen van zijn dienstverlening zelfstandig verwerkingsverantwoordelijke zijn; daarvoor geldt ook de privacyinformatie van Stripe.",
      ],
      [
        "Ontvangende mailprovider",
        `Contactberichten en antwoorden worden ook verwerkt in onze supportmailbox. De actuele provider is: ${organisation.mailboxProvider}.`,
      ],
    ],
  },
  {
    number: "05",
    title: "HOELANG BEWAREN WE GEGEVENS?",
    paragraphs: [
      "We bewaren gegevens zolang dat nodig is voor het betreffende doel of zolang een wettelijke verplichting dat vereist. Niet alle gegevens hebben dezelfde bewaartermijn. Als een langere bewaring nodig is, beperken we die tot de relevante gegevens en het noodzakelijke doel.",
    ],
    items: [
      [
        "Account- en profielgegevens",
        "Tijdens het gebruik van je account en daarna voor zover nodig voor de afhandeling van een verwijderverzoek, openstaande verplichtingen of een andere geldige reden. Een beëindigd account is geen reden om alle bijbehorende gegevens onbeperkt te bewaren.",
      ],
      [
        "Gewone contactcorrespondentie",
        "We verwijderen gewone contactcorrespondentie binnen drie maanden nadat de vraag is afgehandeld. Als een bericht onderdeel is van een boekingsgeschil, financiële administratie of privacyverzoek, bewaren we alleen de daarvoor noodzakelijke gegevens volgens het bijbehorende doel en bewaarbeleid.",
      ],
      [
        "Technische registratie van contactinzendingen",
        "De afzonderlijke technische supportregistratie bevat geen berichtinhoud. Registraties ouder dan 48 uur worden bij een volgende aanvraag opgeruimd. Bij afwezigheid van nieuwe aanvragen kan deze metadata langer blijven staan. Deze opschoning verwijdert geen mails bij Resend of in onze mailbox.",
      ],
      [
        "Boekingen, betalingen en geschillen",
        "Zolang nodig voor uitvoering, terugbetalingen, administratie en de afhandeling van geschillen. Voor gegevens die tot een wettelijk verplichte administratie behoren, geldt de toepasselijke wettelijke bewaartermijn. Dat betekent niet dat alle profielgegevens of berichten automatisch even lang moeten worden bewaard.",
      ],
      [
        "Privacyverzoeken en uitvoerregistraties",
        "Voor zover nodig om het verzoek uit te voeren, resterende werkzaamheden op te volgen en de afhandeling te kunnen verantwoorden. De bewaartermijnen en opschoning van verzoek-, audit- en workerregistraties moeten in ons definitieve bewaarbeleid afzonderlijk worden vastgelegd.",
      ],
      [
        "Statusbewijzen",
        "Een nieuw statusbewijs voor accountverwijdering is in beginsel 90 dagen geldig vanaf uitgifte. Dit is een toegangstermijn voor het raadplegen van de status, niet automatisch de verwijderdatum van de bijbehorende verzoek- of auditgegevens.",
      ],
      [
        "Maildiensten en back-ups",
        "Verwijdering uit een actieve applicatie verwijdert niet noodzakelijk direct alle kopieën bij een maildienst, ontvanger of in back-ups. Resend vermeldt algemeen 30 dagen retentie voor Free, Pro en Scale. We gebruiken die algemene informatie niet als garantie dat iedere specifieke mail en alle back-ups na exact 30 dagen volledig zijn verwijderd.",
      ],
    ],
  },
  {
    number: "06",
    title: "JE ACCOUNT VERWIJDEREN",
    paragraphs: [
      "Je kunt via Contact een verzoek tot accountverwijdering indienen. Als de verwijderfunctie voor jouw account beschikbaar is, kun je die ook vanuit Account gebruiken. Via Contact kun je eveneens hulp vragen als je niet meer kunt inloggen of een statusbewijs kwijt bent.",
      "We controleren je identiteit op een manier die past bij het verzoek en vragen niet meer informatie dan daarvoor nodig is. Een e-mailadres dat in een openbaar formulier is ingevuld, bewijst op zichzelf niet dat de afzender de accounthouder is.",
      "Het verwijderen van je account en het afronden van alle gegevensafhandeling kunnen verschillende stappen zijn. Openstaande boekingen, betalingen, klachten of gegevens bij dienstverleners kunnen afzonderlijke beoordeling vereisen. Als gegevens rechtmatig moeten worden behouden, verwijderen we niet zonder meer die noodzakelijke administratie.",
      "We informeren je over de behandeling van je verzoek en, waar van toepassing, waarom bepaalde gegevens nog nodig zijn. Een technische wachtrij of openstaande externe taak verlengt op zichzelf geen wettelijke reactietermijn.",
      "Stuur via het contactformulier geen wachtwoorden, statusbewijzen, volledige betaalgegevens of kopieën van identiteitsdocumenten.",
    ],
    items: [],
  },
  {
    number: "07",
    title: "BEVEILIGING",
    paragraphs: [
      "We nemen technische en organisatorische maatregelen die passen bij de verwerking en de risico’s. Daarbij gebruiken we onder meer beveiligde verbindingen, toegangscontroles, server-side bevoegdheidscontroles en maatregelen tegen misbruik.",
      "Technische beveiliging biedt geen absolute garantie tegen incidenten. We beoordelen incidenten en nemen waar nodig maatregelen en de wettelijk vereiste vervolgstappen.",
    ],
    items: [],
  },
  {
    number: "08",
    title: "JOUW PRIVACYRECHTEN",
    paragraphs: [
      "Onder de AVG kun je, afhankelijk van de omstandigheden, vragen om inzage, correctie, verwijdering, beperking van de verwerking en overdracht van gegevens. Je kunt bezwaar maken tegen verwerking op basis van gerechtvaardigd belang en gegeven toestemming intrekken.",
      "We reageren zonder onnodige vertraging en in beginsel binnen één maand na ontvangst van je verzoek. Als de wet vanwege de complexiteit of het aantal verzoeken een verlenging toestaat, informeren we je binnen die eerste maand over de verlenging en de reden. De verlenging kan maximaal twee extra maanden bedragen.",
      "Deze rechten zijn niet in iedere situatie onbeperkt. Als we een verzoek niet of niet volledig kunnen uitvoeren, leggen we uit waarom en informeren we je over de mogelijkheden om daartegen op te komen.",
      "Je mag rechtstreeks een klacht indienen bij de Autoriteit Persoonsgegevens of een andere bevoegde privacytoezichthouder. Je hoeft daarvoor niet eerst onze klachtenprocedure te doorlopen.",
    ],
    items: [],
  },
  {
    number: "09",
    title: "COOKIES EN APP-OPSLAG",
    paragraphs: [
      "De website en app gebruiken lokale opslag en vergelijkbare technieken voor functies zoals inloggen, voorkeuren en het bewaren van een verwijderstatusbewijs. De gebruikte techniek kan verschillen tussen de website, lokaal webgebruik en de mobiele app.",
      "Deze verklaring geeft geen toestemming voor tracking of marketing. Als we niet-noodzakelijke technieken inzetten waarvoor toestemming vereist is, moeten we die toestemming vooraf afzonderlijk vragen. Ons cookiebeleid moet aansluiten op de technieken die daadwerkelijk zijn ingeschakeld.",
    ],
    items: [],
  },
];

export default function PrivacyPage() {
  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      <SiteHeader />

      <section className="relative flex-1 overflow-hidden py-12 sm:py-16 lg:py-20">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 -top-16 select-none font-display text-[15rem] leading-none text-[#D6FF3F] opacity-[0.04] sm:text-[24rem] lg:text-[32rem]"
        >
          PRIVACY
        </div>

        <div className="relative mx-auto max-w-5xl px-5 sm:px-8">
          <div className="border-b-2 border-white/20 pb-8">
            <p className="font-display text-lg text-[#FF4B3E]">
              GOWTRAIN · PRIVACY
            </p>

            <h1 className="mt-3 font-display text-6xl leading-[0.83] sm:text-7xl lg:text-8xl">
              PRIVACY-
              <br />
              VERKLARING.
            </h1>

            <p className="mt-7 max-w-2xl text-lg leading-relaxed text-[#D7D9DA] sm:text-xl">
              Hier lees je welke persoonsgegevens we gebruiken
              voor de website en app van Gowtrain, waarom we
              dat doen en welke rechten je hebt.
            </p>

            <p className="mt-5 font-display text-sm text-[#D6FF3F]">
              LAATST BIJGEWERKT: {lastUpdated.toUpperCase()}
            </p>
          </div>

          {isDraft && (
            <aside className="mt-8 border-2 border-[#FF4B3E] bg-white/5 p-5">
              <h2 className="font-display text-xl text-[#FF8A80]">
                CONCEPT · NOG AAN TE VULLEN
              </h2>

              <p className="mt-3 text-sm leading-relaxed text-[#D7D9DA]">
                Deze verklaring is nog niet definitief. De
                identificatie van de verantwoordelijke, de actuele
                mailprovider en onderdelen van het bewaarbeleid en
                de internationale gegevensverwerking moeten nog
                worden aangevuld en gecontroleerd.
              </p>
            </aside>
          )}

          <div className="mt-10 border-2 border-white bg-white p-3 text-[#14171A] shadow-[8px_8px_0_0_#FF4B3E]">
            <div className="bg-[#14171A] p-5 text-white sm:p-8 lg:p-10">
              <div className="space-y-12">
                <section>
                  <p className="font-display text-lg text-[#FF4B3E]">
                    01 / VERANTWOORDELIJKE
                  </p>

                  <h2 className="mt-3 font-display text-4xl leading-tight text-[#D6FF3F] sm:text-5xl">
                    WIE ZIJN WIJ?
                  </h2>

                  <p className="mt-5 leading-relaxed text-[#D7D9DA]">
                    Gowtrain is een platform waarop spelers padel-
                    en tennistrainers kunnen vinden en trainingen
                    kunnen boeken. Trainers beheren er hun profiel,
                    aanbod en boekingen.
                  </p>

                  <div className="mt-6 space-y-2 border-l-2 border-[#D6FF3F] pl-5 text-sm leading-relaxed text-[#B9BEC2]">
                    <p>
                      <strong className="text-white">
                        Verwerkingsverantwoordelijke:
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
                        KvK:
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
                      . Dit is ook zonder login bereikbaar.
                    </p>
                  </div>
                </section>

                {sections.map((section) => (
                  <section key={section.number}>
                    <p className="font-display text-lg text-[#FF4B3E]">
                      {section.number} / PRIVACY
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

                    {section.items.length > 0 && (
                      <dl className="mt-6 space-y-5">
                        {section.items.map(([title, description]) => (
                          <div
                            key={title}
                            className="border-l-2 border-white/30 pl-5"
                          >
                            <dt className="font-semibold text-white">
                              {title}
                            </dt>
                            <dd className="mt-2 text-sm leading-relaxed text-[#B9BEC2]">
                              {description}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    )}

                    {section.number === "08" && (
                      <div className="mt-6 space-y-3 text-sm">
                        <p>
                          <Link
                            href="/support"
                            className="text-[#D6FF3F] underline underline-offset-4 hover:text-white"
                          >
                            Dien een privacyverzoek in via Contact
                          </Link>
                        </p>

                        <p>
                          <a
                            href="https://www.autoriteitpersoonsgegevens.nl"
                            className="text-[#D6FF3F] underline underline-offset-4 hover:text-white"
                          >
                            Naar de Autoriteit Persoonsgegevens
                          </a>
                        </p>
                      </div>
                    )}

                    {section.number === "09" && (
                      <p className="mt-5 text-sm">
                        <Link
                          href="/cookies"
                          className="text-[#D6FF3F] underline underline-offset-4 hover:text-white"
                        >
                          Lees het cookiebeleid
                        </Link>
                      </p>
                    )}
                  </section>
                ))}

                <section>
                  <p className="font-display text-lg text-[#FF4B3E]">
                    10 / INTERNATIONALE VERWERKING
                  </p>

                  <h2 className="mt-3 font-display text-3xl leading-tight text-[#D6FF3F] sm:text-4xl">
                    LOCATIES EN WAARBORGEN.
                  </h2>

                  <p className="mt-5 leading-relaxed text-[#D7D9DA]">
                    De locaties waar gegevens worden verwerkt hangen
                    af van de gekozen diensten, regio-instellingen
                    en betrokken subverwerkers. Een Europese
                    opslagregio sluit toegang of verdere verwerking
                    buiten de Europese Economische Ruimte niet
                    automatisch uit.
                  </p>

                  <p className="mt-4 leading-relaxed text-[#D7D9DA]">
                    Voor doorgifte buiten de Europese Economische
                    Ruimte is een geldige AVG-doorgiftegrond nodig,
                    zoals een toepasselijk adequaatheidsbesluit of
                    passende waarborgen. Je kunt via Contact
                    informatie vragen over de toepasselijke
                    waarborgen en hoe je daarvan een kopie kunt
                    verkrijgen.
                  </p>

                  <p className="mt-4 border-l-2 border-[#FF4B3E] pl-4 text-sm leading-relaxed text-[#B9BEC2]">
                    [VÓÓR DEFINITIEVE PUBLICATIE AANVULLEN:
                    werkelijke verwerkingsregio’s, relevante
                    doorgiften en toepasselijke waarborgen per
                    dienstverlener controleren.]
                  </p>
                </section>

                <section className="border-t-2 border-white/20 pt-8">
                  <h2 className="font-display text-3xl text-[#D6FF3F]">
                    CONTACT EN WIJZIGINGEN.
                  </h2>

                  <p className="mt-4 leading-relaxed text-[#B9BEC2]">
                    Heb je een vraag over deze verklaring of de
                    verwerking van je gegevens? Gebruik het
                    contactformulier op de website of Contact
                    in de app.
                  </p>

                  <p className="mt-4 leading-relaxed text-[#B9BEC2]">
                    We kunnen deze verklaring aanpassen wanneer
                    onze dienstverlening of de toepasselijke
                    regels veranderen. De actuele versie en
                    wijzigingsdatum staan op deze pagina.
                    Waar nodig informeren we je afzonderlijk
                    over belangrijke wijzigingen.
                  </p>
                </section>
              </div>
            </div>
          </div>

          <div className="mt-10 flex flex-col justify-between gap-5 border-t-2 border-white/20 pt-8 sm:flex-row sm:items-center">
            <p className="font-display text-2xl">
              EEN VRAAG OVER JE GEGEVENS?
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