type SiteFooterProps = {
  showAppBadges?: boolean;
};

export default function SiteFooter({
  showAppBadges = true,
}: SiteFooterProps) {
  return (
    <footer className="border-t border-white/20 bg-[#14171A] text-white">
      <div className="mx-auto max-w-7xl px-5 py-10 sm:px-8">
        <div className="flex flex-col justify-between gap-10 border-b border-white/20 pb-10 md:flex-row md:items-start">
          {/* Logo en app-downloads */}
          <div className="flex flex-col items-start gap-6">
            <a
              href="/"
              aria-label="GowTrain home"
              className="inline-flex items-center gap-2"
            >
              <span className="font-display text-4xl leading-none text-[#D6FF3F]">
                GOWTRAIN
              </span>

              <span
                aria-hidden="true"
                className="mt-1 h-0 w-0 border-b-[11px] border-l-[9px] border-t-[11px] border-b-transparent border-l-[#D6FF3F] border-t-transparent"
              />
            </a>

            {showAppBadges ? (
              <div className="flex flex-wrap items-center gap-3">
                <a
                  href="#"
                  aria-label="Download GowTrain in de App Store"
                  className="transition duration-200 hover:-translate-y-1 hover:opacity-85"
                >
                  <img
                    src="/images/apple.png"
                    alt="Download on the App Store"
                    className="h-11 w-auto"
                  />
                </a>

                <a
                  href="#"
                  aria-label="Download GowTrain via Google Play"
                  className="transition duration-200 hover:-translate-y-1 hover:opacity-85"
                >
                  <img
                    src="/images/google.png"
                    alt="Get it on Google Play"
                    className="h-11 w-auto"
                  />
                </a>
              </div>
            ) : null}
          </div>

          {/* Navigatie en socials */}
          <div className="flex flex-col items-start gap-7 md:items-end">
            <nav
              aria-label="Footer navigatie"
              className="grid grid-cols-2 gap-x-12 gap-y-4 font-display text-lg sm:flex sm:flex-wrap sm:justify-end sm:gap-x-8 sm:gap-y-4"
            >
              <a href="/#spelers" className="transition hover:text-[#D6FF3F]">
                SPELERS
              </a>

              <a
                href="/#trainers"
                className="transition hover:text-[#D6FF3F]"
              >
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
              <a
  href="/voorwaarden"
  className="transition hover:text-[#D6FF3F]"
>
  VOORWAARDEN
</a>
<a href="/cookies" className="transition hover:text-[#D6FF3F]">
  COOKIES
</a>
            </nav>

            <div className="flex items-center gap-3">
              {/* Facebook */}
              <a
                href="#"
                aria-label="Volg GowTrain op Facebook"
                className="flex h-10 w-10 items-center justify-center border-2 border-white text-white transition hover:-translate-y-1 hover:border-[#D6FF3F] hover:bg-[#D6FF3F] hover:!text-[#14171A]"
              >
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="h-5 w-5 fill-current"
                >
                  <path d="M13.5 21v-8h2.7l.4-3.1h-3.1V7.93c0-.9.25-1.51 1.54-1.51h1.65V3.65c-.29-.04-1.27-.12-2.42-.12-2.4 0-4.04 1.47-4.04 4.17V9.9H7.5V13h2.71v8h3.29Z" />
                </svg>
              </a>

              {/* Instagram */}
              <a
                href="#"
                aria-label="Volg GowTrain op Instagram"
                className="flex h-10 w-10 items-center justify-center border-2 border-white text-white transition hover:-translate-y-1 hover:border-[#D6FF3F] hover:bg-[#D6FF3F] hover:!text-[#14171A]"
              >
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="h-5 w-5 fill-none stroke-current stroke-[2]"
                >
                  <rect x="3" y="3" width="18" height="18" rx="5" />
                  <circle cx="12" cy="12" r="4" />
                  <circle
                    cx="17.5"
                    cy="6.5"
                    r="1"
                    className="fill-current stroke-none"
                  />
                </svg>
              </a>

              {/* TikTok */}
              <a
                href="#"
                aria-label="Volg GowTrain op TikTok"
                className="flex h-10 w-10 items-center justify-center border-2 border-white text-white transition hover:-translate-y-1 hover:border-[#D6FF3F] hover:bg-[#D6FF3F] hover:!text-[#14171A]"
              >
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="h-5 w-5 fill-current"
                >
                  <path d="M16.73 5.3c.64.73 1.58 1.24 2.7 1.31v3.04a7.18 7.18 0 0 1-2.67-.52v5.96a5.4 5.4 0 1 1-5.4-5.4c.2 0 .4.01.6.04v3.02a2.38 2.38 0 1 0 1.78 2.3V3h2.99c0 .83.28 1.62 1 2.3Z" />
                </svg>
              </a>

              {/* YouTube */}
              <a
                href="#"
                aria-label="Volg GowTrain op YouTube"
                className="flex h-10 w-10 items-center justify-center border-2 border-white text-white transition hover:-translate-y-1 hover:border-[#D6FF3F] hover:bg-[#D6FF3F] hover:!text-[#14171A]"
              >
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="h-5 w-5 fill-current"
                >
                  <path d="M21.58 7.19a2.97 2.97 0 0 0-2.09-2.1C17.65 4.6 12 4.6 12 4.6s-5.65 0-7.49.49a2.97 2.97 0 0 0-2.09 2.1C1.93 9.03 1.93 12 1.93 12s0 2.97.49 4.81a2.97 2.97 0 0 0 2.09 2.1c1.84.49 7.49.49 7.49.49s5.65 0 7.49-.49a2.97 2.97 0 0 0 2.09-2.1c.49-1.84.49-4.81.49-4.81s0-2.97-.49-4.81ZM9.9 15.02V8.98L15.16 12 9.9 15.02Z" />
                </svg>
              </a>
            </div>
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
  );
}