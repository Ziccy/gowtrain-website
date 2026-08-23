const trainerCards = [
  {
    initials: "TP",
    name: "TOM PEETERS",
    meta: "Padel · Tactiek & gevorderden",
    rating: "4.8",
    distance: "0.8 KM",
    price: "€80",
    color: "bg-[#D6FF3F]",
  },
  {
    initials: "SV",
    name: "SARAH VERMEULEN",
    meta: "Tennis · Beginners & techniek",
    rating: "4.9",
    distance: "2.1 KM",
    price: "€75",
    color: "bg-[#FF4B3E]",
  },
  {
    initials: "JD",
    name: "JESSE DE VRIES",
    meta: "Padel · Smash & wedstrijdspel",
    rating: "4.7",
    distance: "3.4 KM",
    price: "€60",
    color: "bg-white",
  },
];

const steps = [
  {
    number: "01",
    title: "VIND.",
    text: "Zoek padel- en tennistrainers bij jou in de buurt.",
  },
  {
    number: "02",
    title: "KIES.",
    text: "Vergelijk specialisaties, prijzen en beschikbare momenten.",
  },
  {
    number: "03",
    title: "GOW!",
    text: "Boek je les. Geen heen-en-weer geapp. Wel de baan op.",
  },
];

const trainerBenefits = [
  "Jouw profiel zichtbaar voor actieve spelers.",
  "Beschikbaarheid en boekingen op één plek.",
  "Minder plannen. Meer lesgeven.",
  "Bouw aan jouw klantenbestand.",
];

export default function Home() {
  return (
    <main className="overflow-hidden bg-[#14171A] text-white">
      {/* HERO */}
      <section
        id="home"
        className="relative isolate min-h-screen overflow-hidden bg-[#14171A]"
      >
        {/* Green glow */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-[-25rem] top-1/2 h-[52rem] w-[52rem] -translate-y-1/2 rounded-full bg-[#D6FF3F] opacity-[0.08] blur-[180px]"
        />

        {/* Groot GOW op achtergrond */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 bottom-[-5rem] z-0 select-none font-display text-[19rem] leading-none text-[#D6FF3F] opacity-[0.05] sm:text-[27rem] lg:text-[38rem]"
        >
          GOW
        </div>

        {/* Padelbaan */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-[-8%] right-[-28%] z-0 hidden h-[86%] w-[72%] border-[3px] border-[#D6FF3F]/20 lg:block"
        >
          <div className="absolute left-1/2 top-0 h-full w-[3px] -translate-x-1/2 bg-[#D6FF3F]/20" />
          <div className="absolute left-0 top-[32%] h-[3px] w-full bg-[#D6FF3F]/20" />
          <div className="absolute left-0 top-[68%] h-[3px] w-full bg-[#D6FF3F]/20" />
          <div className="absolute left-[25%] top-0 h-full w-[3px] bg-[#D6FF3F]/10" />
          <div className="absolute right-[25%] top-0 h-full w-[3px] bg-[#D6FF3F]/10" />
        </div>

        {/* HEADER */}
        <header className="relative z-30">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:py-7">
            {/* GOWTRAIN LOGO */}
            <a
              href="#home"
              aria-label="GowTrain home"
              className="group inline-flex items-center gap-2"
            >
              <span className="font-display text-3xl leading-none text-[#D6FF3F] sm:text-4xl">
                GOWTRAIN
              </span>

              <span className="mt-1 h-0 w-0 border-b-[9px] border-l-[8px] border-t-[9px] border-b-transparent border-l-[#D6FF3F] border-t-transparent transition-transform duration-200 group-hover:translate-x-1 sm:border-b-[11px] sm:border-l-[9px] sm:border-t-[11px]" />
            </a>

            {/* Navigatie */}
            <nav
              aria-label="Hoofdnavigatie"
              className="hidden items-center gap-8 font-display text-lg md:flex lg:gap-12"
            >
              <a
                href="#spelers"
                className="transition hover:text-[#D6FF3F]"
              >
                SPELERS
              </a>

              <a
                href="#trainers"
                className="transition hover:text-[#D6FF3F]"
              >
                TRAINERS
              </a>

              <a
                href="#over-gowtrain"
                className="transition hover:text-[#D6FF3F]"
              >
                OVER
              </a>
            </nav>

            <a
              href="#spelers"
              className="bg-[#FF4B3E] px-4 py-3 font-display text-sm text-white transition hover:bg-[#D6FF3F] hover:text-[#14171A] sm:px-5"
            >
              GOW!
            </a>
          </div>
        </header>

        {/* HERO CONTENT */}
        <div className="relative z-10 mx-auto max-w-7xl px-5 pb-16 pt-16 sm:px-8 sm:pt-20 lg:pb-24 lg:pt-24">
          <div className="grid items-end gap-12 lg:grid-cols-[1.1fr_0.9fr]">
            {/* Linkerkant */}
            <div className="max-w-4xl">
              <h1 className="font-display text-[4.2rem] leading-[0.82] tracking-[-0.03em] sm:text-[6.5rem] md:text-[8rem] lg:text-[9.5rem]">
                ÉÉN TIK.
                <br />
                EN JE STAAT
                <br />
                OP DE BAAN.
              </h1>

              <div className="mt-8 grid gap-6 sm:grid-cols-[auto_1fr] sm:items-start">
                <p className="font-display text-4xl leading-[0.9] text-[#D6FF3F] sm:text-5xl">
                  TRAINERS VINDEN.
                  <br />
                  BOEKEN. GOW!
                </p>

                <p className="max-w-sm border-l-2 border-[#FF4B3E] pl-5 text-base leading-relaxed text-[#D7D9DA] sm:mt-2 sm:text-lg">
                  Vind de trainer die bij jou past. Kies je moment. Sta sneller
                  op de baan.
                </p>
              </div>

              {/* Hero buttons */}
              <div className="mt-10 flex flex-col gap-4 sm:flex-row">
  <a
    href="#spelers"
    className="inline-flex items-center justify-center gap-4 bg-[#FF4B3E] px-7 py-5 font-display text-xl text-white transition duration-200 hover:-translate-y-1 hover:bg-[#D6FF3F] hover:!text-[#14171A]"
  >
    VIND JE TRAINER
    <span aria-hidden="true" className="text-inherit">
      →
    </span>
  </a>

  <a
    href="#trainers"
    className="inline-flex items-center justify-center gap-4 border-2 border-white px-7 py-5 font-display text-xl text-white transition duration-200 hover:-translate-y-1 hover:bg-white hover:!text-[#14171A]"
  >
    TRAINER WORDEN
    <span aria-hidden="true" className="text-inherit">
      →
    </span>
  </a>
</div>
            </div>

            {/* TOM PEETERS TRAINERKAART */}
            <div className="relative mx-auto hidden w-full max-w-md lg:block lg:translate-x-14 lg:-translate-y-16">
              <div className="absolute -left-7 -top-7 h-28 w-28 border-l-[3px] border-t-[3px] border-[#D6FF3F]" />

              <div className="relative border-2 border-white bg-white p-3 text-[#14171A] shadow-[12px_12px_0_0_#FF4B3E]">
                <div className="bg-[#14171A] p-6 text-white">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#D6FF3F] font-display text-xl text-[#14171A]">
                        TP
                      </div>

                      <div>
                        <p className="font-display text-2xl">TOM PEETERS</p>
                        <p className="mt-1 text-sm text-[#B9BEC2]">
                          Padel · Tactiek &amp; gevorderden
                        </p>
                      </div>
                    </div>

                    <span className="bg-[#D6FF3F] px-3 py-2 font-display text-sm text-[#14171A]">
                      4.8 ★
                    </span>
                  </div>

                  <div className="mt-7 grid grid-cols-2 border-y border-white/20 py-4">
                    <div>
                      <p className="font-display text-2xl">VANDAAG</p>
                      <p className="mt-1 text-sm text-[#B9BEC2]">
                        18:00 – 19:00
                      </p>
                    </div>

                    <div className="border-l border-white/20 pl-5">
                      <p className="font-display text-2xl">€80</p>
                      <p className="mt-1 text-sm text-[#B9BEC2]">PER LES</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="mt-5 w-full bg-[#FF4B3E] py-4 font-display text-xl text-white transition hover:bg-[#D6FF3F] hover:text-[#14171A]"
                  >
                    GOW!
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="absolute bottom-5 left-1/2 z-10 hidden -translate-x-1/2 items-center gap-3 font-display text-sm text-[#D6FF3F] lg:flex">
          SCROLL OM TE STARTEN
          <span className="h-8 w-[2px] bg-[#D6FF3F]" />
        </div>
      </section>

      {/* VOOR SPELERS */}
      <section id="spelers" className="bg-white py-20 text-[#14171A] sm:py-28">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
            <div>
              <p className="font-display text-lg text-[#FF4B3E]">
                VOOR SPELERS
              </p>

              <h2 className="mt-4 font-display text-6xl leading-[0.83] sm:text-7xl lg:text-8xl">
                ZOEK.
                <br />
                BOEK.
                
                GOW!
              </h2>

              <p className="mt-7 max-w-sm text-lg leading-relaxed text-[#53595E]">
                Geen eindeloos zoeken via Instagram of WhatsApp. Jouw volgende
                training begint hier.
              </p>
            </div>

            <div className="grid gap-0 border-l-2 border-[#14171A] sm:grid-cols-3 sm:border-l-0">
              {steps.map((step, index) => (
                <article
                  key={step.number}
                  className={`border-b-2 border-[#14171A] p-6 last:border-b-0 sm:border-b-0 sm:p-7 ${
                    index !== steps.length - 1 ? "sm:border-r-2" : ""
                  }`}
                >
                  <p className="font-display text-5xl text-[#FF4B3E]">
                    {step.number}
                  </p>

                  <h3 className="mt-10 font-display text-4xl">{step.title}</h3>

                  <p className="mt-4 leading-relaxed text-[#53595E]">
                    {step.text}
                  </p>
                </article>
              ))}
            </div>
          </div>

          <div className="mt-14 flex flex-col justify-between gap-6 border-t-2 border-[#14171A] pt-7 sm:flex-row sm:items-center">
            <p className="font-display text-2xl">
              JOUW VOLGENDE LES BEGINT MET ÉÉN TIK.
            </p>

            <a
  href="#trainers-overzicht"
  className="inline-flex w-fit items-center gap-3 bg-[#14171A] px-6 py-4 font-display text-lg !text-white transition hover:bg-[#FF4B3E] hover:!text-white"
>
  VIND EEN TRAINER
  <span aria-hidden="true" className="text-inherit">
    →
  </span>
</a>
          </div>
        </div>
      </section>

      {/* TRAINER OVERZICHT */}
      <section
        id="trainers-overzicht"
        className="bg-[#D6FF3F] py-20 text-[#14171A] sm:py-28"
      >
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
            <div>
              <p className="font-display text-lg text-[#FF4B3E]">
                VIND JOUW MATCH
              </p>

              <h2 className="mt-4 font-display text-6xl leading-[0.83] sm:text-7xl">
                TRAINERS
                <br />
                BIJ JOU.
              </h2>
            </div>

            <p className="max-w-md text-lg leading-relaxed text-[#303438]">
              Bekijk trainers op sport, specialisatie, prijs en beschikbaarheid.
              Jij kiest. Jij Gowt.
            </p>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {trainerCards.map((trainer) => (
              <article
                key={trainer.name}
                className="group border-2 border-[#14171A] bg-white p-4 transition duration-200 hover:-translate-y-2 hover:shadow-[8px_8px_0_0_#14171A]"
              >
                <div className="bg-[#14171A] p-5 text-white">
                  <div className="flex items-start justify-between gap-4">
                    <div
                      className={`flex h-12 w-12 items-center justify-center rounded-full font-display text-lg text-[#14171A] ${trainer.color}`}
                    >
                      {trainer.initials}
                    </div>

                    <span className="font-display text-sm text-[#D6FF3F]">
                      {trainer.rating} ★
                    </span>
                  </div>

                  <div className="pt-6">
  <h3 className="font-display text-3xl">
    {trainer.name}
  </h3>

  <p className="mt-2 min-h-10 text-sm leading-relaxed text-[#B9BEC2]">
    {trainer.meta}
  </p>
</div>

                  <div className="mt-6 flex items-end justify-between border-t border-white/20 pt-4">
                    <span className="font-display text-sm text-[#B9BEC2]">
                      {trainer.distance}
                    </span>

                    <span className="font-display text-3xl">
                      {trainer.price}
                    </span>
                  </div>

                  <button
                    type="button"
                    className="mt-5 w-full bg-[#FF4B3E] py-3 font-display text-lg text-white transition group-hover:bg-[#D6FF3F] group-hover:text-[#14171A]"
                  >
                    GOW!
                  </button>
                </div>
              </article>
            ))}
          </div>

          <div className="mt-10 text-center">
            <a
  href="#spelers"
  className="inline-flex items-center gap-3 border-2 border-[#14171A] px-7 py-4 font-display text-lg text-[#14171A] transition hover:bg-[#14171A] hover:!text-white"
>
  BEKIJK ALLE TRAINERS
  <span aria-hidden="true" className="text-inherit">
    →
  </span>
</a>
          </div>
        </div>
      </section>

      {/* VOOR TRAINERS */}
      <section
        id="trainers"
        className="relative overflow-hidden bg-[#FF4B3E] py-20 text-white sm:py-28"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 -top-24 select-none font-display text-[19rem] leading-none text-white opacity-[0.1] sm:text-[28rem]"
        >
          +
        </div>

        <div className="relative mx-auto grid max-w-7xl gap-12 px-5 sm:px-8 lg:grid-cols-[1fr_0.85fr] lg:items-end">
          <div>
            <p className="font-display text-lg text-[#14171A]">
              VOOR TRAINERS
            </p>

            <h2 className="mt-4 max-w-3xl font-display text-6xl leading-[0.83] sm:text-7xl lg:text-8xl">
              MEER
              <br />
              LESGEVEN.
              <br />
              MINDER GEDOE.
            </h2>

            <p className="mt-8 max-w-xl text-lg leading-relaxed text-white/90 sm:text-xl">
              GowTrain helpt je zichtbaar te worden, je agenda te vullen en
              boekingen overzichtelijk te houden.
            </p>

            <a
              href="mailto:info@gowtrain.nl?subject=Ik%20wil%20trainer%20worden%20bij%20GowTrain"
              className="mt-9 inline-flex items-center gap-4 bg-[#14171A] px-7 py-5 font-display text-xl text-white transition hover:-translate-y-1 hover:bg-[#D6FF3F] hover:text-[#14171A]"
            >
              WORD TRAINER. GOW! <span aria-hidden="true">→</span>
            </a>
          </div>

          <div className="border-2 border-[#14171A] bg-[#14171A] p-6 sm:p-8">
            <p className="font-display text-3xl text-[#D6FF3F]">
              JIJ FOCUST OP DE BAAN.
            </p>

            <ul className="mt-8 space-y-5">
              {trainerBenefits.map((benefit, index) => (
                <li key={benefit} className="flex gap-4 text-lg leading-snug">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center bg-[#D6FF3F] font-display text-sm text-[#14171A]">
                    0{index + 1}
                  </span>

                  <span>{benefit}</span>
                </li>
              ))}
            </ul>

            <div className="mt-9 border-t border-white/20 pt-6">
              <p className="font-display text-xl">
                JOUW AGENDA. JOUW PROFIEL. JOUW GROWTH.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* OVER GOWTRAIN */}
      <section
        id="over-gowtrain"
        className="bg-[#14171A] py-20 text-white sm:py-28"
      >
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <p className="font-display text-lg text-[#FF4B3E]">
                OVER GOWTRAIN
              </p>

              <h2 className="mt-4 font-display text-6xl leading-[0.83] sm:text-7xl">
                KLAAR?
                <br />
                GOW!
              </h2>
            </div>

            <div className="max-w-2xl">
              <p className="text-xl leading-relaxed text-[#E3E5E6] sm:text-2xl">
                GowTrain brengt spelers en trainers samen op één plek. Snel
                vinden, direct boeken en vooral: meer tijd op de baan.
              </p>

              <div className="mt-12 grid gap-5 sm:grid-cols-2">
                <div className="border-l-2 border-[#D6FF3F] pl-5">
                  <p className="font-display text-4xl text-[#D6FF3F]">
                    DIRECT
                  </p>

                  <p className="mt-2 leading-relaxed text-[#B9BEC2]">
                    Van zoeken naar boeken zonder omwegen.
                  </p>
                </div>

                <div className="border-l-2 border-[#FF4B3E] pl-5">
                  <p className="font-display text-4xl text-[#FF4B3E]">
                    BETROUWBAAR
                  </p>

                  <p className="mt-2 leading-relaxed text-[#B9BEC2]">
                    Duidelijke profielen, prijzen en afspraken.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* EIND CTA */}
<section className="bg-white py-20 text-[#14171A] sm:py-28">
  <div className="mx-auto flex max-w-7xl flex-col items-center px-5 text-center sm:px-8">
    <p className="font-display text-lg text-[#FF4B3E]">
      JOUW VOLGENDE TRAINING WACHT
    </p><br></br>

    <h2 className="mt-5 w-full max-w-5xl font-display text-6xl leading-[0.83] sm:text-7xl lg:text-8xl">
      <span className="block text-center">STA JIJ</span>
      <span className="block text-center">STRAKS OP DE BAAN?</span>
    </h2>

    <a
      href="#trainers-overzicht"
      className="mt-10 inline-flex items-center gap-4 bg-[#FF4B3E] px-8 py-5 font-display text-xl text-white transition hover:-translate-y-1 hover:bg-[#14171A] hover:!text-white"
    >
      VIND JE TRAINER. GOW!
      <span aria-hidden="true" className="text-inherit">
        →
      </span>
    </a>
  </div>
</section>

      {/* FOOTER */}
      <footer className="bg-[#14171A] text-white">
        <div className="mx-auto max-w-7xl px-5 py-10 sm:px-8">
          <div className="flex flex-col justify-between gap-10 border-b border-white/20 pb-10 md:flex-row md:items-start">
            <a
              href="#home"
              aria-label="GowTrain home"
              className="inline-flex items-center gap-2"
            >
              <span className="font-display text-4xl leading-none text-[#D6FF3F]">
                GOWTRAIN
              </span>

              <span className="mt-1 h-0 w-0 border-b-[11px] border-l-[9px] border-t-[11px] border-b-transparent border-l-[#D6FF3F] border-t-transparent" />
            </a>

            <div className="grid grid-cols-2 gap-x-12 gap-y-4 font-display text-lg sm:flex sm:gap-8">
              <a href="#spelers" className="transition hover:text-[#D6FF3F]">
                SPELERS
              </a>

              <a href="#trainers" className="transition hover:text-[#D6FF3F]">
                TRAINERS
              </a>

              <a
                href="mailto:info@gowtrain.nl"
                className="transition hover:text-[#D6FF3F]"
              >
                CONTACT
              </a>

              <a
                href="/privacy"
                className="transition hover:text-[#D6FF3F]"
              >
                PRIVACY
              </a>
            </div>
          </div>

          <div className="flex flex-col gap-3 pt-6 text-sm text-[#8A8F94] sm:flex-row sm:items-center sm:justify-between">
            <p>
              © {new Date().getFullYear()} GowTrain. Alle rechten voorbehouden.
            </p>

            <p>TRAINERS VINDEN. BOEKEN. GOW!</p>
          </div>
        </div>
      </footer>
    </main>
  );
}