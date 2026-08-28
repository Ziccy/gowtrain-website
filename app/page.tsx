import SiteFooter from "@/components/SiteFooter";

const trainerCards = [
  {
    initials: "TP",
    name: "TOM PEETERS",
    meta: "Padel · Tactiek & gevorderden",
    rating: "4.8",
    distance: "0.8 KM",
    price: "€42",
    color: "bg-[#D6FF3F]",
  },
  {
    initials: "SV",
    name: "SARAH VERMEULEN",
    meta: "Tennis · Beginners & techniek",
    rating: "4.9",
    distance: "2.1 KM",
    price: "€45",
    color: "bg-[#FF4B3E]",
  },
  {
    initials: "JD",
    name: "JESSE DE VRIES",
    meta: "Padel · Smash & wedstrijdspel",
    rating: "4.7",
    distance: "3.4 KM",
    price: "€38",
    color: "bg-white",
  },
];

const steps = [
  {
    number: "01",
    title: "ZOEK.",
    text: "Vind padel- en tennistrainers direct bij jou in de buurt.",
  },
  {
    number: "02",
    title: "KIES.",
    text: "Vergelijk specialisaties, uurtarieven en live beschikbaarheid.",
  },
  {
    number: "03",
    title: "GOW!",
    text: "Boek direct met één tik. Geen heen-en-weer ge-app. De baan op.",
  },
];

const trainerBenefits = [
  "Direct zichtbaar voor actieve spelers in jouw regio.",
  "Geen WhatsApp-chaos meer: lessen en betalingen via de app.",
  "Geen maandelijkse kosten, slechts 5% commissie per boeking.",
  "Volledige controle over je eigen agenda en uurtarief.",
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

        {/* Padelbaan Decoratie */}
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
              <a href="#spelers" className="transition hover:text-[#D6FF3F]">
                SPELERS
              </a>
              <a href="#trainers" className="transition hover:text-[#D6FF3F]">
                TRAINERS
              </a>
              <a href="#over-gowtrain" className="transition hover:text-[#D6FF3F]">
                OVER
              </a>
            </nav>

            <a
              href="/speler-worden"
              className="bg-[#FF4B3E] px-4 py-3 font-display text-sm text-white transition hover:bg-[#D6FF3F] hover:!text-[#14171A] sm:px-5"
            >
              GOW!
            </a>
          </div>
        </header>

        {/* HERO CONTENT */}
        <div className="relative z-10 mx-auto max-w-7xl px-5 pb-16 pt-12 sm:px-8 sm:pt-16 lg:pb-24 lg:pt-20">
          <div className="grid items-end gap-12 lg:grid-cols-[1.1fr_0.9fr]">
            {/* Linkerkant */}
            <div className="max-w-4xl">
              <h1 className="font-display text-[4.2rem] leading-[0.82] tracking-[-0.03em] sm:text-[6.5rem] md:text-[8rem] lg:text-[9.2rem]">
                ÉÉN TIK.
                <br />
                EN JE STAAT
                <br />
                OP DE BAAN.
              </h1>

              <div className="mt-8 grid gap-6 sm:grid-cols-[auto_1fr] sm:items-start">
                <p className="font-display text-3xl leading-[0.9] text-[#D6FF3F] sm:text-4xl">
                  TRAINERS VINDEN.
                  <br />
                  BOEKEN. GOW!
                </p>

                <p className="max-w-sm border-l-2 border-[#FF4B3E] pl-5 text-base leading-relaxed text-[#D7D9DA] sm:text-lg">
                  Koppel direct met padel- en tennistrainers in jouw buurt. Kies je tijdslot en sta vandaag nog op de baan.
                </p>
              </div>

              {/* Directe Zoekbalk in Hero */}
              <form action="/trainers" method="GET" className="mt-8 max-w-xl">
                <div className="flex flex-col border-2 border-white bg-white p-2 shadow-[8px_8px_0_0_#FF4B3E] sm:flex-row sm:items-center">
                  <input
                    type="text"
                    name="q"
                    placeholder="Zoek op stad of gemeente..."
                    className="w-full bg-transparent px-4 py-3 text-[#14171A] outline-none font-sans font-medium placeholder:text-[#8A8F94]"
                  />
                  <button
                    type="submit"
                    className="mt-2 w-full bg-[#FF4B3E] px-6 py-3 font-display text-lg text-white transition hover:bg-[#D6FF3F] hover:text-[#14171A] sm:mt-0 sm:w-auto"
                  >
                    ZOEKEN. GOW!
                  </button>
                </div>
              </form>

              {/* Hero CTA buttons */}
              <div className="mt-8 flex flex-col gap-4 sm:flex-row">
                <a
                  href="/trainers"
                  className="inline-flex items-center justify-center gap-4 bg-[#FF4B3E] px-7 py-4 font-display text-xl text-white transition duration-200 hover:-translate-y-1 hover:bg-[#D6FF3F] hover:!text-[#14171A]"
                >
                  BEKIJK ALLE TRAINERS
                  <span aria-hidden="true" className="text-inherit">→</span>
                </a>

                <a
                  href="/trainer-worden"
                  className="inline-flex items-center justify-center gap-4 border-2 border-white px-7 py-4 font-display text-xl text-white transition duration-200 hover:-translate-y-1 hover:bg-white hover:!text-[#14171A]"
                >
                  WORD TRAINER
                  <span aria-hidden="true" className="text-inherit">→</span>
                </a>
              </div>
            </div>

            {/* TRAINERKAART (Brandbook Pagina 13 stijl) */}
            <div className="relative mx-auto hidden w-full max-w-md lg:block lg:translate-x-14 lg:-translate-y-16">
              <div className="absolute -left-7 -top-7 h-28 w-28 border-l-[3px] border-t-[3px] border-[#D6FF3F]" />

              <div className="relative border-2 border-white bg-white p-3 text-[#14171A] shadow-[12px_12px_0_0_#FF4B3E]">
                <div className="bg-[#14171A] p-6 text-white">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#14171A] border-2 border-[#D6FF3F] font-display text-xl text-[#D6FF3F]">
                        TP
                      </div>
                      <div>
                        <p className="font-display text-2xl">TOM PEETERS</p>
                        <p className="mt-1 text-sm text-[#B9BEC2]">
                          Padel · Tactiek &amp; gevorderden
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Rating & Afstand Badge uit Brandbook Pagina 13 */}
                  <div className="mt-4 flex gap-2">
                    <span className="bg-[#D6FF3F] px-3 py-1 font-display text-sm text-[#14171A]">
                      4.8 ★
                    </span>
                    <span className="bg-black px-3 py-1 font-display text-sm text-white">
                      0.8 KM
                    </span>
                  </div>

                  <div className="mt-6 flex items-end justify-between border-t border-white/20 pt-4">
                    <div>
                      <p className="text-xs text-[#8A8F94]">PRIJS PER LES</p>
                      <p className="font-display text-4xl text-[#D6FF3F]">€42</p>
                    </div>

                    <a
                      href="/trainers"
                      className="bg-[#FF4B3E] px-8 py-3 font-display text-xl text-white transition hover:bg-[#D6FF3F] hover:text-[#14171A]"
                    >
                      GOW!
                    </a>
                  </div>
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
                ZOEK.<br />
                BOEK.<br />
                GOW!
              </h2>

              <p className="mt-7 max-w-sm text-lg leading-relaxed text-[#53595E]">
                Geen eindeloos ge-app via WhatsApp of Instagram. Vind direct je trainer en claim je tijdslot.
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
              href="/trainers"
              className="inline-flex w-fit items-center gap-3 bg-[#14171A] px-6 py-4 font-display text-lg !text-white transition hover:bg-[#FF4B3E] hover:!text-white"
            >
              VIND EEN TRAINER
              <span aria-hidden="true" className="text-inherit">→</span>
            </a>
          </div>
        </div>
      </section>

      {/* DOWNLOAD DE APP */}
      <section
        id="download"
        className="relative overflow-hidden bg-[#14171A] py-20 text-white sm:py-28"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 -top-24 select-none font-display text-[18rem] leading-none text-[#D6FF3F] opacity-[0.06] sm:text-[28rem]"
        >
          APP
        </div>

        <div className="relative mx-auto grid max-w-7xl gap-12 px-5 sm:px-8 lg:grid-cols-[1fr_0.8fr] lg:items-end">
          <div>
            <p className="font-display text-lg text-[#FF4B3E]">
              ALLES IN ÉÉN APP
            </p>

            <h2 className="mt-4 max-w-4xl font-display text-6xl leading-[0.83] sm:text-7xl lg:text-8xl">
              JOUW TRAINING.<br />
              JOUW MOMENT.<br />
              GOW!
            </h2>

            <p className="mt-8 max-w-xl text-lg leading-relaxed text-[#D7D9DA] sm:text-xl">
              Zoek trainers, vergelijk specialisaties, bekijk beschikbaarheid en
              boek je les. Alles regel je snel en overzichtelijk in de GowTrain-app.
            </p>

            <div className="mt-10 flex flex-col gap-4 sm:flex-row">
              <a
                href="#"
                className="inline-flex items-center justify-center gap-3 bg-white px-6 py-4 font-display text-lg !text-[#14171A] transition hover:-translate-y-1 hover:bg-[#D6FF3F] hover:!text-[#14171A]"
              >
                DOWNLOAD VOOR IOS
                <span aria-hidden="true" className="text-inherit">→</span>
              </a>

              <a
                href="#"
                className="inline-flex items-center justify-center gap-3 border-2 border-white px-6 py-4 font-display text-lg text-white transition hover:-translate-y-1 hover:bg-white hover:!text-[#14171A]"
              >
                DOWNLOAD VOOR ANDROID
                <span aria-hidden="true" className="text-inherit">→</span>
              </a>
            </div>

            <p className="mt-5 text-sm text-[#8A8F94]">
              Binnenkort beschikbaar in de App Store en Google Play Store.
            </p>
          </div>

          {/* iPhone-preview */}
          <div className="relative mx-auto h-[560px] w-full max-w-[380px] overflow-hidden">
            <div className="relative min-h-[760px] rounded-t-[3.5rem] border-x-[8px] border-t-[8px] border-[#2A2E31] bg-[#14171A] p-[7px]">
              <div
                aria-hidden="true"
                className="absolute left-1/2 top-5 z-20 h-[26px] w-[118px] -translate-x-1/2 rounded-full bg-[#050607]"
              />

              <div className="h-[745px] overflow-hidden rounded-t-[2.85rem] bg-[#14171A]">
                <img
                  src="/images/gowtrain-app.png"
                  alt="GowTrain app waarin je een trainer en beschikbaar moment kiest"
                  className="h-full w-full object-cover object-top"
                />
              </div>
            </div>
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
                TRAINERS<br />
                BIJ JOU.
              </h2>
            </div>

            <p className="max-w-md text-lg leading-relaxed text-[#303438]">
              Bekijk trainers op sport, specialisatie, uurtarief en afstand.
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

                    {/* Brandbook Badge Layout */}
                    <div className="flex gap-1.5">
                      <span className="bg-[#D6FF3F] px-2.5 py-1 font-display text-xs text-[#14171A]">
                        {trainer.rating} ★
                      </span>
                      <span className="bg-[#303438] px-2 py-1 font-display text-xs text-white">
                        {trainer.distance}
                      </span>
                    </div>
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
                    <div>
                      <span className="block text-xs text-[#8A8F94]">PRIJS PER LES</span>
                      <span className="font-display text-3xl text-[#D6FF3F]">
                        {trainer.price}
                      </span>
                    </div>

                    <a
                      href="/trainers"
                      className="bg-[#FF4B3E] px-6 py-2.5 font-display text-lg text-white transition group-hover:bg-[#D6FF3F] group-hover:text-[#14171A]"
                    >
                      GOW!
                    </a>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <div className="mt-10 text-center">
            <a
              href="/trainers"
              className="inline-flex items-center gap-3 border-2 border-[#14171A] px-7 py-4 font-display text-lg text-[#14171A] transition hover:bg-[#14171A] hover:!text-white"
            >
              BEKIJK ALLE TRAINERS
              <span aria-hidden="true" className="text-inherit">→</span>
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
              MEER LESGEVEN.<br />
              MINDER GEDOE.
            </h2>

            <p className="mt-8 max-w-xl text-lg leading-relaxed text-white/90 sm:text-xl">
              GowTrain helpt je zichtbaar te worden, je agenda te vullen en boekingen overzichtelijk te houden. Geen abonnementen, slechts 5% commissie per les.
            </p>

            <a
              href="/trainer-worden"
              className="mt-9 inline-flex items-center gap-4 bg-[#14171A] px-7 py-5 font-display text-xl text-white transition hover:-translate-y-1 hover:bg-[#D6FF3F] hover:!text-[#14171A]"
            >
              WORD TRAINER. GOW! <span aria-hidden="true">→</span>
            </a>
          </div>

          <div className="border-2 border-[#14171A] bg-[#14171A] p-6 sm:p-8 shadow-[8px_8px_0_0_#14171A]">
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
              <p className="font-display text-xl text-[#D7D9DA]">
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
                KLAAR?<br />
                GOW!
              </h2>
            </div>

            <div className="max-w-2xl">
              <p className="text-xl leading-relaxed text-[#E3E5E6] sm:text-2xl">
                GowTrain brengt padel- en tennistrainers en spelers direct samen op één platform. Snel zoeken, transparant vergelijken en boeken zonder omwegen.
              </p>

              <div className="mt-12 grid gap-5 sm:grid-cols-2">
                <div className="border-l-2 border-[#D6FF3F] pl-5">
                  <p className="font-display text-4xl text-[#D6FF3F]">
                    DIRECT
                  </p>
                  <p className="mt-2 leading-relaxed text-[#B9BEC2]">
                    Van zoeken naar boeken in een paar tikken.
                  </p>
                </div>

                <div className="border-l-2 border-[#FF4B3E] pl-5">
                  <p className="font-display text-4xl text-[#FF4B3E]">
                    BETROUWBAAR
                  </p>
                  <p className="mt-2 leading-relaxed text-[#B9BEC2]">
                    Duidelijke afspraken, transparante prijzen en geverifieerde profielen.
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
            DOWNLOAD DE APP. GOW!
          </p>

          <h2 className="mt-4 w-full max-w-5xl font-display text-6xl leading-[0.83] sm:text-7xl lg:text-8xl">
            <span className="block text-center">JOUW VOLGENDE</span>
            <span className="block text-center">TRAINING BEGINT HIER.</span>
          </h2>

          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a
              href="#"
              className="inline-flex w-full items-center justify-center gap-4 bg-[#FF4B3E] px-8 py-5 font-display text-xl text-white transition hover:-translate-y-1 hover:bg-[#14171A] hover:!text-white sm:w-auto"
            >
              DOWNLOAD VOOR IOS
              <span aria-hidden="true" className="text-inherit">→</span>
            </a>

            <a
              href="#"
              className="inline-flex w-full items-center justify-center gap-4 border-2 border-[#14171A] px-8 py-5 font-display text-xl text-[#14171A] transition hover:-translate-y-1 hover:bg-[#14171A] hover:!text-white sm:w-auto"
            >
              DOWNLOAD VOOR ANDROID
              <span aria-hidden="true" className="text-inherit">→</span>
            </a>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <SiteFooter />
    </main>
  );
}