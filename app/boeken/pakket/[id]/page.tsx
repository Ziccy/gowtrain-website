"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { supabase } from "@/lib/supabase-browser";

type PlayerProfile = {
  full_name: string | null;
  role: string;
};

type AuthenticatedPlayer = {
  id: string;
  email: string;
  fullName: string;
};

type VenueSummary = {
  id: string;
  name: string;
  city: string;
  address_line: string;
  postal_code: string | null;
};

type TrainerSummary = {
  id: string;
  name: string;
  sport: string;
  focus: string;
  image_url: string | null;
};

type PackageDetail = {
  id: string;
  trainer_id: string;
  title: string;
  sport: "padel" | "tennis";
  lesson_count: number;
  duration_minutes: number;
  starts_at: string;
  price_cents: number;
  currency: string;
  max_participants: number;
  trainer: TrainerSummary | null;
  venue: VenueSummary | null;
};

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  })
    .format(value)
    .toUpperCase();
}

function formatTime(value: Date): string {
  return new Intl.DateTimeFormat("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function formatEuro(cents: number, currency = "eur"): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

export default function PackageBookingPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const packageId = Array.isArray(params.id) ? params.id[0] : params.id;

  const [player, setPlayer] = useState<AuthenticatedPlayer | null>();
  const [pkg, setPkg] = useState<PackageDetail | null>();

  const [loading, setLoading] = useState<boolean>(true);
  const [booking, setBooking] = useState<boolean>(false);

  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    if (!packageId) {
      setLoading(false);
      setErrorMessage("Dit lespakket kon niet worden gevonden.");
      return;
    }

    void initializePage(packageId);
  }, [packageId]);

  function redirectToPlayerLogin(): void {
    const redirectTo = `/boeken/pakket/${packageId}`;
    router.replace(`/speler-login?redirectTo=${encodeURIComponent(redirectTo)}`);
  }

  async function initializePage(selectedPackageId: string): Promise<void> {
    setLoading(true);
    setErrorMessage("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        redirectToPlayerLogin();
        return;
      }

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user || !user.email) {
        await supabase.auth.signOut();
        redirectToPlayerLogin();
        return;
      }

      const { data: profileData } = await supabase
        .from("profiles")
        .select("full_name, role")
        .eq("id", user.id)
        .maybeSingle();

      const profile = profileData as PlayerProfile;

      if (profile?.role !== "player") {
        if (profile?.role === "trainer") {
          router.replace("/trainer-dashboard");
          return;
        }
        await supabase.auth.signOut();
        redirectToPlayerLogin();
        return;
      }

      setPlayer({
        id: user.id,
        email: user.email,
        fullName: profile.full_name?.trim() || user.email.split("@")[0],
      });

      const { data: pkgData, error: pkgError } = await supabase
        .from("trainer_packages")
        .select(
          `
            id,
            trainer_id,
            title,
            sport,
            lesson_count,
            duration_minutes,
            starts_at,
            price_cents,
            currency,
            max_participants,

            trainer:trainers!trainer_packages_trainer_id_fkey (
              id,
              name,
              sport,
              focus,
              image_url
            ),

            venue:venues!trainer_packages_location_id_fkey (
              id,
              name,
              city,
              address_line,
              postal_code
            )
          `
        )
        .eq("id", selectedPackageId)
        .eq("is_active", true)
        .single();

      if (pkgError || !pkgData) {
        setPkg(null);
        setErrorMessage("Dit lespakket is niet meer beschikbaar.");
        return;
      }

      setPkg(pkgData as unknown as PackageDetail);
    } catch {
      setErrorMessage("Het lespakket kon niet worden geladen.");
    } finally {
      setLoading(false);
    }
  }

  const lessonDates = useMemo(() => {
    if (!pkg) return [];
    const dates: Array<{ number: number; date: Date }> = [];
    const startDate = new Date(pkg.starts_at);

    for (let i = 0; i < pkg.lesson_count; i++) {
      const lessonDate = new Date(startDate);
      lessonDate.setDate(lessonDate.getDate() + i * 7);
      dates.push({ number: i + 1, date: lessonDate });
    }

    return dates;
  }, [pkg]);

  async function handlePackageCheckout(): Promise<void> {
    if (!pkg || !player) return;

    setBooking(true);
    setErrorMessage("");

    try {
      window.location.href = `/boeken/checkout?packageId=${pkg.id}`;
    } catch {
      setErrorMessage("De betaalpagina kon niet worden geopend.");
      setBooking(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-[#14171A] px-5 text-white">
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-2">
            <span className="font-display text-5xl text-[#D6FF3F] sm:text-6xl">
              GOWTRAIN
            </span>
            <span className="h-0 w-0 animate-pulse border-b-[14px] border-l-[12px] border-t-[14px] border-b-transparent border-l-[#D6FF3F] border-t-transparent" />
          </div>
          <p className="mt-4 font-display text-sm tracking-widest text-[#FF4B3E]">
            TRAJECT LADEN...
          </p>
        </div>
      </main>
    );
  }

  if (!pkg) {
    return (
      <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
        <SiteHeader />

        <section className="flex flex-1 items-center justify-center px-5 py-16">
          <div className="w-full max-w-xl border-2 border-white bg-white p-3 text-[#14171A] shadow-[10px_10px_0_0_#FF4B3E]">
            <div className="bg-[#14171A] p-6 text-white sm:p-8">
              <p className="font-display text-lg text-[#FF4B3E]">PAKKET NIET BESCHIKBAAR</p>
              <h1 className="mt-4 font-display text-5xl leading-[0.85]">DIT TRAJECT IS EVEN WEG.</h1>
              <p className="mt-6 text-lg leading-relaxed text-[#B9BEC2]">
                {errorMessage || "Dit lespakket is niet meer beschikbaar."}
              </p>
              <Link href="/trainers" className="mt-8 inline-flex bg-[#FF4B3E] px-6 py-4 font-display text-lg text-white hover:bg-[#D6FF3F] hover:text-[#14171A]">
                BEKIJK ALLE TRAINERS →
              </Link>
            </div>
          </div>
        </section>

        <SiteFooter />
      </main>
    );
  }

  const perLessonPriceCents = Math.round(pkg.price_cents / pkg.lesson_count);

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      {/* 💡 UNIVERSELE DYNAMISCHE SITE HEADER */}
      <SiteHeader />

      {/* CONTENT */}
      <section className="relative flex-1 overflow-hidden py-10 sm:py-14">
        <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-20 select-none font-display text-[17rem] leading-none text-[#D6FF3F] opacity-[0.04]">
          GOW
        </div>

        <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
          
          {/* HEADER BAR */}
          <div className="flex flex-col justify-between gap-6 border-b-2 border-white/20 pb-8 lg:flex-row lg:items-end">
            <div>
              <span className="bg-[#D6FF3F] px-3 py-1 font-display text-xs text-[#14171A]">
                {pkg.lesson_count}-WEKEN TRAJECT
              </span>
              <h1 className="mt-3 font-display text-5xl leading-[0.83] sm:text-6xl lg:text-7xl">
                {pkg.title.toUpperCase()}
              </h1>
              <p className="mt-3 max-w-2xl text-base text-[#D7D9DA]">
                Bij {pkg.trainer?.name || "je trainer"}. Leg in 1 keer je wekelijkse trainingsmoment vast.
              </p>
            </div>

            <div className="border-2 border-[#D6FF3F] bg-[#D6FF3F] p-5 text-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]">
              <p className="font-display text-xs">TOTAALPRIJS TRAJECT</p>
              <p className="font-display text-4xl leading-none mt-1">
                {formatEuro(pkg.price_cents, pkg.currency)}
              </p>
              <p className="mt-1 text-xs font-semibold">
                Slechts {formatEuro(perLessonPriceCents, pkg.currency)} per les (incl. baanhuur)
              </p>
            </div>
          </div>

          {errorMessage && (
            <div role="alert" className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] px-5 py-4 font-semibold text-white">
              {errorMessage}
            </div>
          )}

          {/* MAIN GRID */}
          <div className="mt-10 grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
            
            {/* LINKER KOLOM: ALLE DATUMS VAN HET TRAJECT */}
            <section>
              <p className="font-display text-lg text-[#FF4B3E]">TRAJECT PLANNING</p>
              <h2 className="mt-1 font-display text-3xl sm:text-4xl">
                ALLE {pkg.lesson_count} LESSEN.
              </h2>
              <p className="mt-2 text-xs text-[#B9BEC2]">
                Iedere week op hetzelfde tijdstip: <strong>{formatTime(new Date(pkg.starts_at))} uur</strong> ({pkg.duration_minutes} minuten).
              </p>

              <div className="mt-5 space-y-3">
                {lessonDates.map((item) => (
                  <div
                    key={item.number}
                    className="flex items-center justify-between border-2 border-white/20 bg-white/5 p-3.5 text-white"
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center bg-[#D6FF3F] font-display text-xs text-[#14171A]">
                        {item.number < 10 ? `0${item.number}` : item.number}
                      </span>
                      <div>
                        <p className="font-display text-base text-white">
                          LES {item.number}: {formatDate(item.date)}
                        </p>
                        <p className="text-[11px] text-[#B9BEC2]">
                          {formatTime(item.date)} uur · {pkg.duration_minutes} min
                        </p>
                      </div>
                    </div>

                    <span className="font-display text-xs text-[#D6FF3F]">✓ INCLUSIEF</span>
                  </div>
                ))}
              </div>
            </section>

            {/* RECHTER KOLOM: OVERZICHT & AFREKENEN */}
            <section className="lg:sticky lg:top-8">
              <p className="font-display text-lg text-[#FF4B3E]">DETAILS &amp; AFREKENEN</p>
              <h2 className="mt-1 font-display text-3xl sm:text-4xl">
                BEVESTIG JE TRAJECT.
              </h2>

              <div className="mt-5 border-2 border-white bg-white p-3 text-[#14171A] shadow-[8px_8px_0_0_#FF4B3E]">
                <div className="bg-[#14171A] p-5 text-white space-y-5">
                  
                  {/* TRAINER INFO */}
                  {pkg.trainer && (
                    <div className="flex items-center gap-4 border-b border-white/20 pb-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[#D6FF3F] bg-[#14171A]">
                        {pkg.trainer.image_url ? (
                          <img src={pkg.trainer.image_url} alt={pkg.trainer.name} className="h-full w-full object-cover" />
                        ) : (
                          <span className="font-display text-lg text-[#D6FF3F]">{pkg.trainer.name.slice(0, 2).toUpperCase()}</span>
                        )}
                      </div>
                      <div>
                        <p className="font-display text-xs text-[#FF4B3E]">JOUW TRAINER</p>
                        <p className="font-display text-xl">{pkg.trainer.name}</p>
                        <p className="text-xs text-[#B9BEC2]">{pkg.trainer.focus}</p>
                      </div>
                    </div>
                  )}

                  {/* LOCATIE INFO */}
                  {pkg.venue && (
                    <div className="border-b border-white/20 pb-4">
                      <p className="font-display text-xs text-[#FF4B3E]">VASTE TRAININGSLOCATIE</p>
                      <p className="mt-1 font-display text-base">{pkg.venue.city.toUpperCase()} — {pkg.venue.name}</p>
                      <p className="mt-0.5 text-xs text-[#B9BEC2]">{pkg.venue.address_line}, {pkg.venue.city}</p>
                    </div>
                  )}

                  {/* SPELER INFO */}
                  <div>
                    <p className="font-display text-xs text-[#FF4B3E]">BOEKER</p>
                    <p className="mt-1 font-display text-lg text-white">{player?.fullName}</p>
                    <p className="text-xs text-[#B9BEC2]">{player?.email}</p>
                  </div>

                  {/* PRIJS TOTAAL */}
                  <div className="bg-white/5 p-4 border-l-2 border-[#D6FF3F]">
                    <p className="font-display text-xs text-[#D6FF3F]">TOTAALPRIJS ({pkg.lesson_count} LESSEN)</p>
                    <p className="font-display text-3xl text-[#D6FF3F] mt-1">
                      {formatEuro(pkg.price_cents, pkg.currency)}
                    </p>
                    <p className="mt-1 text-xs text-[#B9BEC2]">
                      Eénmalige betaling voor het gehele {pkg.lesson_count}-weken traject inclusief baanhuur.
                    </p>
                  </div>

                  {/* SUBMIT BUTTON */}
                  <button
                    type="button"
                    onClick={() => void handlePackageCheckout()}
                    disabled={booking}
                    className="flex w-full items-center justify-center gap-2 bg-[#FF4B3E] px-6 py-4 font-display text-lg text-white transition hover:bg-[#D6FF3F] hover:!text-[#14171A] disabled:opacity-60"
                  >
                    {booking ? "BEZIG MET BOEKEN..." : "RESERVEER PAKKET. GOW! →"}
                  </button>

                  <p className="text-center text-xs text-[#8A8F94]">
                    Veilige afhandeling via GowTrain Embedded Checkout.
                  </p>

                </div>
              </div>

            </section>

          </div>

        </div>
      </section>

      <SiteFooter />
    </main>
  );
}