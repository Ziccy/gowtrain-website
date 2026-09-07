"use client";

import Link from "next/link";
import { useState } from "react";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";

type FAQCategory = "players" | "trainers" | "payments";

type FAQItem = {
  question: string;
  answer: string;
  category: FAQCategory;
};

const faqItems: FAQItem[] = [
  // VOOR SPELERS
  {
    category: "players",
    question: "IS DE PRIJS OP GOWTRAIN INCLUSIEF BAANHUUR?",
    answer:
      "Ja, 100%! Alle getoonde prijzen op GowTrain voor zowel losse lessen als lespakketten zijn altijd inclusief de training én de baanhuur op de betreffende club. Zo kom je achteraf nooit voor verrassingen te staan.",
  },
  {
    category: "players",
    question: "HOE WERKT HET BOEKEN VAN EEN LES OF TRAJECT?",
    answer:
      "Zoek via de homepage of de trainerspagina een trainer bij jou in de buurt. Kies een los beschikbaar tijdslot of een compleet lespakket en druk op Gow!. Na een snelle betaling via iDEAL of creditcard staat je les direct vast in je dashboard.",
  },
  {
    category: "players",
    question: "WAT GEBEURT ER BIJ SLECHT WEER (REGEN/STORM)?",
    answer:
      "Geen zorgen. Mocht een outdoor training niet door kunnen gaan vanwege regen of storm, dan wordt de les in overleg met de trainer gratis verplaatst naar een nieuwe datum. Mocht dat niet lukken, dan ontvang je een volledige terugbetaling.",
  },
  {
    category: "players",
    question: "KAN IK EEN GEBOEKTE LES ANNULEREN?",
    answer:
      "Ja! Tot 24 uur voor aanvang van de les kun je via 'Mijn boekingen' kosteloos annuleren. Je ontvangt dan automatisch 100% van het bedrag terug via de oorspronkelijke betaalmethode. Bij annulering binnen 24 uur vervalt het recht op restitutie omdat de baan en trainer al gereserveerd staan.",
  },

  // VOOR TRAINERS
  {
    category: "trainers",
    question: "WAT KOST GOWTRAIN VOOR EEN TRAINER?",
    answer:
      "Registreren en een profiel aanmaken is 100% gratis. Er zijn geen maandelijkse abonnementskosten of vaste verplichtingen. GowTrain inhoudt automatisch een kleine commissie van 5% in per daadwerkelijk geboekte les. Geen boekingen betekent dus nul kosten.",
  },
  {
    category: "trainers",
    question: "HOE EN WANNEER WORD IK UITBETAALD?",
    answer:
      "Uitbetalingen verlopen veilig en geautomatiseerd via Stripe Connect. Zodra een les is afgerond, wordt het geld automatisch naar de door jou gekoppelde bankrekening overgemaakt.",
  },
  {
    category: "trainers",
    question: "HOUD IK ZELF CONTROLE OVER MIJN AGENDA EN TARIEVEN?",
    answer:
      "Absoluut. Jij bepaalt 100% zelf op welke clubs/locaties je lesgeeft, welke tijden je openzet en welk uurtarief je rekent. Je kunt losse slots publiceren of wekelijkse vaste patronen en lespakketten instellen.",
  },
  {
    category: "trainers",
    question: "HOE WERKEN LESPAKKETTEN & TRAJECTEN?",
    answer:
      "Met een lespakket bied je een 5- tot 12-weken traject aan (bijv. 10 weken padeltactiek). Spelers betalen het volledige bedrag vooraf in 1 keer via de app. Zo heb jij direct gegarandeerde inkomsten en een volle agenda voor de komende weken.",
  },

  // BETALINGEN & VEILIGHEID
  {
    category: "payments",
    question: "WELKE BETAALMETHODEN WORDEN ONDERSTEUND?",
    answer:
      "Je kunt veilig en snel betalen via iDEAL, Creditcard (Visa, Mastercard, Amex) of Bancontact. Alle transacties worden versleuteld verwerkt via onze gecertificeerde betaalpartner Stripe.",
  },
  {
    category: "payments",
    question: "HOE ONTVANG IK MIJN BOEKINGSBEVESTIGING?",
    answer:
      "Direct na je betaling ontvang je een bevestiging per e-mail. Daarnaast staan al je geplande trainingen, inclusief de exacte clublocatie en baannummer, overzichtelijk op de pagina 'Mijn boekingen'.",
  },
  {
    category: "payments",
    question: "WAT MOET IK DOEN ALS IK EEN PROBLEEM HEBT MET EEN LES?",
    answer:
      "Mocht er een probleem zijn (bijv. trainer of speler niet verschenen, of baan onverwacht gesloten), dan kun je via 'Mijn boekingen' of 'Trainer Dashboard' met 1 klik een probleem melden. Ons supportteam pakt dit direct op.",
  },
];

export default function FAQPage() {
  const [activeCategory, setActiveCategory] = useState<FAQCategory>("players");
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const filteredItems = faqItems.filter(
    (item) => item.category === activeCategory
  );

  const toggleAccordion = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      
      {/* HEADER */}
      <SiteHeader />

      {/* HERO / INTRO */}
      <section className="relative flex-1 overflow-hidden py-12 sm:py-16 lg:py-20">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-12 top-0 select-none font-display text-[15rem] leading-none text-[#D6FF3F] opacity-[0.04] sm:text-[23rem] lg:text-[32rem]"
        >
          GOW
        </div>

        <div className="relative mx-auto max-w-5xl px-5 sm:px-8">
          <div className="border-b-2 border-white/20 pb-8">
            <p className="font-display text-lg text-[#FF4B3E]">
              KLAARHEID &amp; TRANSCRITIE
            </p>
            <h1 className="mt-3 font-display text-6xl leading-[0.83] sm:text-7xl lg:text-8xl">
              VEELGESTELDE<br />VRAGEN.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-[#D7D9DA] sm:text-xl">
              Alles wat je wilt weten over boeken, betalingen, kosten en het geven of volgen van trainingen op GowTrain.
            </p>
          </div>

          {/* CATEGORIE SWITCHER */}
          <div className="mt-10 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                setActiveCategory("players");
                setOpenIndex(0);
              }}
              className={`border-2 px-6 py-4 font-display text-base transition ${
                activeCategory === "players"
                  ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A] shadow-[4px_4px_0_0_#FF4B3E]"
                  : "border-white/30 text-white hover:border-white"
              }`}
            >
              🎾 VOOR SPELERS
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveCategory("trainers");
                setOpenIndex(0);
              }}
              className={`border-2 px-6 py-4 font-display text-base transition ${
                activeCategory === "trainers"
                  ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A] shadow-[4px_4px_0_0_#FF4B3E]"
                  : "border-white/30 text-white hover:border-white"
              }`}
            >
              🏆 VOOR TRAINERS
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveCategory("payments");
                setOpenIndex(0);
              }}
              className={`border-2 px-6 py-4 font-display text-base transition ${
                activeCategory === "payments"
                  ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A] shadow-[4px_4px_0_0_#FF4B3E]"
                  : "border-white/30 text-white hover:border-white"
              }`}
            >
              💳 BETALEN &amp; ANNULEREN
            </button>
          </div>

          {/* ACCORDEONS LIJST */}
          <div className="mt-10 space-y-4">
            {filteredItems.map((item, index) => {
              const isOpen = openIndex === index;

              return (
                <article
                  key={item.question}
                  className={`border-2 transition duration-200 ${
                    isOpen
                      ? "border-[#D6FF3F] bg-white text-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]"
                      : "border-white/30 bg-[#14171A] text-white hover:border-white"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleAccordion(index)}
                    className="flex w-full items-center justify-between p-5 text-left sm:p-6 outline-none"
                  >
                    <span className="font-display text-xl sm:text-2xl leading-tight">
                      {item.question}
                    </span>

                    <span
                      className={`ml-4 flex h-10 w-10 shrink-0 items-center justify-center font-display text-2xl transition-transform ${
                        isOpen
                          ? "bg-[#14171A] text-[#D6FF3F] rotate-180"
                          : "border-2 border-white/40 text-white"
                      }`}
                    >
                      {isOpen ? "−" : "+"}
                    </span>
                  </button>

                  {isOpen && (
                    <div className="border-t-2 border-[#14171A] bg-[#14171A] p-5 text-white sm:p-6">
                      <p className="text-base leading-relaxed text-[#D7D9DA] sm:text-lg">
                        {item.answer}
                      </p>
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          {/* HULP BANNER ONDERAAN */}
          <div className="mt-16 border-2 border-white bg-white p-3 text-[#14171A] shadow-[8px_8px_0_0_#FF4B3E]">
            <div className="bg-[#14171A] p-6 text-white sm:p-8 flex flex-col justify-between gap-6 sm:flex-row sm:items-center">
              <div>
                <p className="font-display text-2xl text-[#D6FF3F]">
                  NOG EEN ANDERE VRAAG?
                </p>
                <p className="mt-2 text-sm text-[#B9BEC2]">
                  Ons team helpt je graag verder. Neem contact met ons op of zoek direct een trainer.
                </p>
              </div>

              <Link
                href="/trainers"
                className="inline-flex shrink-0 items-center justify-center bg-[#FF4B3E] px-6 py-4 font-display text-lg text-white transition hover:bg-[#D6FF3F] hover:!text-[#14171A]"
              >
                VIND JE TRAINER →
              </Link>
            </div>
          </div>

        </div>
      </section>

      <SiteFooter />
    </main>
  );
}