"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import SiteFooter from "@/components/SiteFooter";
import { supabase } from "@/lib/supabase-browser";

type ApprovalStatus = "pending" | "approved" | "rejected";
type Sport = "padel" | "tennis";

type TrainerAccount = {
  id: string;
  is_active: boolean;
  approval_status: ApprovalStatus;
};

type Venue = {
  id: string;
  name: string;
  address_line: string;
  postal_code: string | null;
  city: string;
  sports: Sport[];
  court_environment: "indoor" | "outdoor" | "indoor_outdoor" | null;
};

type RecurringAvailability = {
  id: string;
  weekday: number;
  starts_at_time: string;
  ends_at_time: string;
  duration_minutes: number;
  sport: Sport;
  location_id: string;
  max_participants: number;
  price_cents: number;
  currency: string;
  level: string | null;
  booking_deadline_hours: number;
  is_active: boolean;
  venue: Venue | null;
};

type UpdateRecurringAvailabilityResult = {
  recurring_availability_id: string;
  cancelled_slots: number;
  created_slots: number;
  skipped_slots: number;
};

const weekdayOptions = [
  { value: 1, shortLabel: "MA", label: "MAANDAG" },
  { value: 2, shortLabel: "DI", label: "DINSDAG" },
  { value: 3, shortLabel: "WO", label: "WOENSDAG" },
  { value: 4, shortLabel: "DO", label: "DONDERDAG" },
  { value: 5, shortLabel: "VR", label: "VRIJDAG" },
  { value: 6, shortLabel: "ZA", label: "ZATERDAG" },
  { value: 7, shortLabel: "ZO", label: "ZONDAG" },
];

const durationOptions = [30, 60, 90, 120];
const participantOptions = [1, 2, 3, 4];

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatEuro(cents: number, currency = "eur"): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function formatEuroFromInput(value: string): string {
  const parsedValue = Number(value.replace(",", "."));

  if (
    !value.trim() ||
    Number.isNaN(parsedValue) ||
    !Number.isFinite(parsedValue) ||
    parsedValue <= 0
  ) {
    return "–";
  }

  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(parsedValue);
}

function getWeekdayLabel(weekday: number): string {
  return (
    weekdayOptions.find((option) => option.value === weekday)?.label ??
    "ONBEKEND"
  );
}

function getVenueLabel(venue: Venue): string {
  return `${venue.city} — ${venue.name}`;
}

function formatCourtEnvironment(
  environment: Venue["court_environment"]
): string | null {
  if (environment === "indoor") return "BINNEN";
  if (environment === "outdoor") return "BUITEN";
  if (environment === "indoor_outdoor") return "BINNEN & BUITEN";

  return null;
}

function isQuarterHour(timeValue: string): boolean {
  const [, minutesString] = timeValue.split(":");
  const minutes = Number(minutesString);

  return [0, 15, 30, 45].includes(minutes);
}

function toDatabaseTime(timeValue: string): string | null {
  const [hoursString, minutesString] = timeValue.split(":");

  const hours = Number(hoursString);
  const minutes = Number(minutesString);

  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0"
  )}:00`;
}

export default function TrainerBeschikbaarheidWijzigenPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const successMessageRef = useRef<HTMLDivElement | null>(null);

  const recurringAvailabilityId = Array.isArray(params.id)
    ? params.id[0]
    : params.id;

  const [trainerAccount, setTrainerAccount] =
    useState<TrainerAccount | null>();

  const [originalPattern, setOriginalPattern] =
    useState<RecurringAvailability | null>();

  const [selectedWeekday, setSelectedWeekday] = useState(1);
  const [effectiveFrom, setEffectiveFrom] = useState(
    toDateInputValue(new Date())
  );

  const [startTime, setStartTime] = useState("18:00");
  const [endTime, setEndTime] = useState("21:00");
  const [selectedDuration, setSelectedDuration] = useState(60);

  const [selectedSport, setSelectedSport] = useState<Sport>("padel");

  const [venues, setVenues] = useState<Venue[]>([]);
  const [venuesLoading, setVenuesLoading] = useState(true);
  const [selectedVenueId, setSelectedVenueId] = useState("");
  const [venueSearch, setVenueSearch] = useState("");
  const [venuePickerOpen, setVenuePickerOpen] = useState(false);

  const [maxParticipants, setMaxParticipants] = useState(1);
  const [price, setPrice] = useState("");
  const [level, setLevel] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const trainerIsActive =
    trainerAccount?.approval_status === "approved" &&
    trainerAccount?.is_active === true;

  const selectedVenue = useMemo(
    () => venues.find((venue) => venue.id === selectedVenueId) ?? null,
    [venues, selectedVenueId]
  );

  const filteredVenues = useMemo(() => {
    const normalizedSearch = venueSearch.trim().toLocaleLowerCase("nl-NL");

    if (!normalizedSearch) {
      return venues;
    }

    return venues.filter((venue) => {
      const searchableText = [
        venue.name,
        venue.city,
        venue.address_line,
        venue.postal_code ?? "",
      ]
        .join(" ")
        .toLocaleLowerCase("nl-NL");

      return searchableText.includes(normalizedSearch);
    });
  }, [venueSearch, venues]);

  const formattedPrice = useMemo(
    () => formatEuroFromInput(price),
    [price]
  );

  const startMinutes = useMemo(() => {
    const [hoursString, minutesString] = startTime.split(":");

    return Number(hoursString) * 60 + Number(minutesString);
  }, [startTime]);

  const endMinutes = useMemo(() => {
    const [hoursString, minutesString] = endTime.split(":");

    return Number(hoursString) * 60 + Number(minutesString);
  }, [endTime]);

  const blockMinutes =
    endMinutes > startMinutes ? endMinutes - startMinutes : 0;

  const possibleSlots =
    blockMinutes >= selectedDuration
      ? Math.floor(blockMinutes / selectedDuration)
      : 0;

  useEffect(() => {
    if (!recurringAvailabilityId) {
      setLoading(false);
      setErrorMessage("Deze vaste reeks kon niet worden gevonden.");
      return;
    }

    void loadPage();
  }, [recurringAvailabilityId]);

  useEffect(() => {
    if (!successMessage) {
      return;
    }

    window.setTimeout(() => {
      successMessageRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });

      successMessageRef.current?.focus();
    }, 50);
  }, [successMessage]);

  function clearMessages(): void {
    setErrorMessage("");
    setSuccessMessage("");
  }

  function showError(message: string): void {
    setSuccessMessage("");
    setErrorMessage(message);
  }

  async function getCurrentTrainer(): Promise<TrainerAccount | null> {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.user) {
      router.replace("/trainer-login");
      return null;
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      await supabase.auth.signOut();
      router.replace("/trainer-login");
      return null;
    }

    const { data: trainerData, error: trainerError } = await supabase
      .from("trainers")
      .select("id, is_active, approval_status")
      .eq("user_id", user.id)
      .single();

    if (trainerError || !trainerData) {
      console.error("Trainer ophalen fout:", trainerError?.message);

      showError("Je trainerprofiel kon niet worden geladen.");
      return null;
    }

    return trainerData as TrainerAccount;
  }

  async function loadVenues(
    sport: Sport,
    selectedLocationId?: string
  ): Promise<Venue[]> {
    setVenuesLoading(true);

    try {
      const { data, error } = await supabase
        .from("venues")
        .select(
          `
            id,
            name,
            address_line,
            postal_code,
            city,
            sports,
            court_environment
          `
        )
        .eq("is_active", true)
        .contains("sports", [sport])
        .order("city", { ascending: true })
        .order("name", { ascending: true });

      if (error) {
        console.error("Locaties ophalen fout:", error.message);
        showError("De trainingslocaties konden niet worden geladen.");
        return [];
      }

      const loadedVenues = (data ?? []) as Venue[];
      setVenues(loadedVenues);

      if (selectedLocationId) {
        const selected = loadedVenues.find(
          (venue) => venue.id === selectedLocationId
        );

        if (selected) {
          setSelectedVenueId(selected.id);
          setVenueSearch(getVenueLabel(selected));
        }
      }

      return loadedVenues;
    } catch (error) {
      console.error("Onverwachte locaties-fout:", error);
      showError("De trainingslocaties konden niet worden geladen.");
      return [];
    } finally {
      setVenuesLoading(false);
    }
  }

  async function loadPage(): Promise<void> {
    setLoading(true);
    clearMessages();

    try {
      const trainer = await getCurrentTrainer();

      if (!trainer) {
        return;
      }

      setTrainerAccount(trainer);

      const { data: patternData, error: patternError } = await supabase
        .from("recurring_availability")
        .select(
          `
            id,
            weekday,
            starts_at_time,
            ends_at_time,
            duration_minutes,
            sport,
            location_id,
            max_participants,
            price_cents,
            currency,
            level,
            booking_deadline_hours,
            is_active,

            venue:venues!recurring_availability_location_id_fkey (
              id,
              name,
              address_line,
              postal_code,
              city,
              sports,
              court_environment
            )
          `
        )
        .eq("id", recurringAvailabilityId)
        .eq("trainer_id", trainer.id)
        .maybeSingle();

      if (patternError) {
        console.error("Vaste reeks ophalen fout:", patternError.message);
        showError("Deze vaste reeks kon niet worden geladen.");
        return;
      }

      if (!patternData) {
        showError(
          "Deze vaste reeks bestaat niet of kan niet meer worden gewijzigd."
        );
        return;
      }

      const pattern = patternData as unknown as RecurringAvailability;

      setOriginalPattern(pattern);
      setSelectedWeekday(pattern.weekday);
      setStartTime(pattern.starts_at_time.slice(0, 5));
      setEndTime(pattern.ends_at_time.slice(0, 5));
      setSelectedDuration(pattern.duration_minutes);

      setSelectedSport(pattern.sport);
      setMaxParticipants(pattern.max_participants);
      setPrice((pattern.price_cents / 100).toFixed(2));
      setLevel(pattern.level ?? "");

      /*
        De wijziging gaat standaard vanaf vandaag in.
        Alleen toekomstige beschikbare slots worden vervangen.
      */
      setEffectiveFrom(toDateInputValue(new Date()));

      await loadVenues(pattern.sport, pattern.location_id);
    } catch (error) {
      console.error("Onverwachte laadfout:", error);
      showError("Deze vaste reeks kon niet worden geladen.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSportChange(sport: Sport): Promise<void> {
    clearMessages();

    if (sport === selectedSport) {
      return;
    }

    setSelectedSport(sport);
    setSelectedVenueId("");
    setVenueSearch("");
    setVenuePickerOpen(false);

    await loadVenues(sport);
  }

  function handleVenueSearchChange(value: string): void {
    clearMessages();
    setVenueSearch(value);
    setSelectedVenueId("");
    setVenuePickerOpen(true);
  }

  function handleVenueSelect(venue: Venue): void {
    clearMessages();
    setSelectedVenueId(venue.id);
    setVenueSearch(getVenueLabel(venue));
    setVenuePickerOpen(false);
  }

  function clearVenueSelection(): void {
    clearMessages();
    setSelectedVenueId("");
    setVenueSearch("");
    setVenuePickerOpen(true);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    clearMessages();

    if (!trainerAccount || !originalPattern) {
      showError("Deze vaste reeks kon niet worden geladen.");
      return;
    }

    if (!trainerIsActive) {
      showError(
        "Je profiel is nog niet actief. Je kunt vaste reeksen pas wijzigen nadat je trainerprofiel is goedgekeurd."
      );
      return;
    }

    if (!effectiveFrom) {
      showError("Kies vanaf welke datum de wijziging geldt.");
      return;
    }

    if (!selectedVenue || !selectedVenueId) {
      showError("Kies een trainingslocatie.");
      return;
    }

    if (!isQuarterHour(startTime) || !isQuarterHour(endTime)) {
      showError(
        "Kies een start- en eindtijd per kwartier: :00, :15, :30 of :45."
      );
      return;
    }

    const databaseStartTime = toDatabaseTime(startTime);
    const databaseEndTime = toDatabaseTime(endTime);

    if (!databaseStartTime || !databaseEndTime) {
      showError("Kies een geldige start- en eindtijd.");
      return;
    }

    if (endMinutes <= startMinutes) {
      showError("De eindtijd moet na de starttijd liggen.");
      return;
    }

    if (possibleSlots < 1) {
      showError(
        "De gekozen lesduur past niet binnen dit tijdsblok. Kies een langere periode of een kortere lesduur."
      );
      return;
    }

    if (maxParticipants < 1 || maxParticipants > 4) {
      showError("Kies een geldig maximaal aantal spelers.");
      return;
    }

    const priceNumber = Number(price.replace(",", "."));

    if (
      Number.isNaN(priceNumber) ||
      !Number.isFinite(priceNumber) ||
      priceNumber <= 0
    ) {
      showError("Vul een geldige totaalprijs in.");
      return;
    }

    const priceCents = Math.round(priceNumber * 100);

    if (priceCents <= 0) {
      showError("Vul een geldige totaalprijs in.");
      return;
    }

    setSaving(true);

    try {
      const { data, error } = await supabase.rpc(
        "update_recurring_availability_from_date",
        {
          p_recurring_availability_id: originalPattern.id,
          p_effective_from: effectiveFrom,

          p_weekday: selectedWeekday,
          p_starts_at_time: databaseStartTime,
          p_ends_at_time: databaseEndTime,
          p_duration_minutes: selectedDuration,

          p_sport: selectedSport,
          p_location_id: selectedVenueId,
          p_max_participants: maxParticipants,
          p_price_cents: priceCents,
          p_level: level.trim() || null,
          p_booking_deadline_hours: 24,
        }
      );

      if (error) {
        console.error("Vaste reeks wijzigen fout:", error.message);

        showError(
          error.message ||
            "Je vaste reeks kon niet worden gewijzigd. Probeer het opnieuw."
        );

        return;
      }

      const result = (
        Array.isArray(data) ? data[0] : data
      ) as UpdateRecurringAvailabilityResult | null;

      if (!result) {
        showError(
          "Je vaste reeks kon niet worden gewijzigd. Probeer het opnieuw."
        );
        return;
      }

      setOriginalPattern((current) =>
        current
          ? {
              ...current,
              weekday: selectedWeekday,
              starts_at_time: databaseStartTime,
              ends_at_time: databaseEndTime,
              duration_minutes: selectedDuration,
              sport: selectedSport,
              location_id: selectedVenueId,
              max_participants: maxParticipants,
              price_cents: priceCents,
              currency: "eur",
              level: level.trim() || null,
              booking_deadline_hours: 24,
              venue: selectedVenue,
              is_active: true,
            }
          : current
      );

      const skippedText =
        result.skipped_slots > 0
          ? ` ${result.skipped_slots} moment${
              result.skipped_slots === 1 ? "" : "en"
            } konden niet opnieuw worden aangemaakt omdat er al een actief, gereserveerd of geboekt slot op dat tijdstip bestaat.`
          : "";

      setSuccessMessage(
        `Je vaste reeks is gewijzigd vanaf ${new Intl.DateTimeFormat(
          "nl-NL",
          {
            day: "numeric",
            month: "long",
            year: "numeric",
          }
        ).format(new Date(`${effectiveFrom}T12:00:00`))}. ${
          result.cancelled_slots
        } beschikbare slots zijn vervangen en ${
          result.created_slots
        } nieuwe slots zijn aangemaakt.${skippedText}`
      );
    } catch (error) {
      console.error("Onverwachte wijzigfout:", error);

      showError(
        "Je vaste reeks kon niet worden gewijzigd. Probeer het opnieuw."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleLogout(): Promise<void> {
    const { error } = await supabase.auth.signOut();

    if (error) {
      showError("Uitloggen lukt nu niet. Probeer het opnieuw.");
      return;
    }

    router.replace("/trainer-login");
    router.refresh();
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#14171A] px-5 text-white">
        <div className="text-center">
          <p className="font-display text-5xl text-[#D6FF3F]">GOW!</p>
          <p className="mt-4 font-display text-lg text-[#FF4B3E]">
            VASTE REEKS LADEN...
          </p>
        </div>
      </main>
    );
  }

  if (!originalPattern && !errorMessage) {
    return (
      <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
        <section className="flex flex-1 items-center justify-center px-5 py-16">
          <div className="max-w-xl border-2 border-[#FF4B3E] bg-[#FF4B3E] p-6">
            <p className="font-display text-3xl">REEKS NIET GEVONDEN.</p>

            <p className="mt-3 leading-relaxed text-white/90">
              Deze vaste reeks bestaat niet meer of kan niet worden gewijzigd.
            </p>

            <a
              href="/trainer-beschikbaarheid"
              className="mt-6 inline-flex bg-[#14171A] px-5 py-3 font-display text-base text-white transition hover:bg-white hover:text-[#14171A]"
            >
              ← TERUG NAAR VASTE MOMENTEN
            </a>
          </div>
        </section>

        <SiteFooter />
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      <header className="border-b border-white/15">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
          <a
            href="/trainer-beschikbaarheid"
            aria-label="Terug naar vaste momenten"
            className="group inline-flex items-center gap-2"
          >
            <span className="font-display text-3xl leading-none text-[#D6FF3F] sm:text-4xl">
              GOWTRAIN
            </span>

            <span className="mt-1 h-0 w-0 border-b-[9px] border-l-[8px] border-t-[9px] border-b-transparent border-l-[#D6FF3F] border-t-transparent transition-transform duration-200 group-hover:translate-x-1 sm:border-b-[11px] sm:border-l-[9px] sm:border-t-[11px]" />
          </a>

          <div className="flex items-center gap-3">
            <a
              href="/trainer-beschikbaarheid"
              className="hidden font-display text-sm text-white transition hover:text-[#D6FF3F] sm:block"
            >
              ← VASTE MOMENTEN
            </a>

            <button
              type="button"
              onClick={() => void handleLogout()}
              className="border-2 border-white px-4 py-2 font-display text-sm text-white transition hover:border-[#D6FF3F] hover:bg-[#D6FF3F] hover:text-[#14171A]"
            >
              UITLOGGEN
            </button>
          </div>
        </div>
      </header>

      <section className="relative flex-1 overflow-hidden py-12 sm:py-16">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 -top-20 select-none font-display text-[16rem] leading-none text-[#D6FF3F] opacity-[0.04] sm:text-[25rem]"
        >
          EDIT
        </div>

        <div className="relative mx-auto max-w-4xl px-5 sm:px-8">
          <div className="border-b-2 border-white/20 pb-8">
            <p className="font-display text-lg text-[#FF4B3E]">
              BESCHIKBAARHEID
            </p>

            <h1 className="mt-3 font-display text-5xl leading-[0.83] sm:text-6xl lg:text-7xl">
              WIJZIG
              <br />
              VASTE REEKS.
            </h1>

            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-[#D7D9DA]">
              Wijzig je vaste beschikbaarheid vanaf een gekozen datum.
              Bevestigde en tijdelijk gereserveerde trainingen blijven altijd
              ongewijzigd.
            </p>
          </div>

          {!trainerIsActive ? (
            <div className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] px-5 py-4">
              <p className="font-display text-lg">
                JE PROFIEL IS NOG NIET ACTIEF.
              </p>
            </div>
          ) : null}

          {errorMessage ? (
            <div
              role="alert"
              className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] px-5 py-4 font-semibold leading-relaxed text-white"
            >
              {errorMessage}
            </div>
          ) : null}

          {successMessage ? (
            <div
              ref={successMessageRef}
              role="status"
              tabIndex={-1}
              className="mt-8 border-2 border-[#D6FF3F] bg-[#D6FF3F] px-5 py-6 text-[#14171A] outline-none shadow-[8px_8px_0_0_#FF4B3E]"
            >
              <p className="font-display text-3xl">REEKS AANGEPAST.</p>

              <p className="mt-3 font-semibold leading-relaxed">
                {successMessage}
              </p>

              <a
                href="/trainer-beschikbaarheid"
                className="mt-6 inline-flex bg-[#14171A] px-5 py-3 font-display text-base text-white transition hover:bg-white hover:text-[#14171A]"
              >
                TERUG NAAR VASTE MOMENTEN →
              </a>
            </div>
          ) : null}

          <form onSubmit={handleSave} className="mt-8">
            <div className="border-2 border-white bg-white p-3 text-[#14171A] shadow-[8px_8px_0_0_#FF4B3E]">
              <div className="bg-[#14171A] p-5 text-white sm:p-8">
                <p className="font-display text-xl text-[#D6FF3F]">
                  NIEUWE REEKSINSTELLINGEN.
                </p>

                <p className="mt-2 text-sm leading-relaxed text-[#B9BEC2]">
                  Toekomstige beschikbare slots worden vervangen. Betaalde en
                  tijdelijk gereserveerde trainingen blijven behouden.
                </p>

                <div className="mt-8">
                  <label
                    htmlFor="effective-from"
                    className="mb-2 block font-display text-base text-[#FF4B3E]"
                  >
                    WIJZIGING GELDT VANAF
                  </label>

                  <input
                    id="effective-from"
                    type="date"
                    value={effectiveFrom}
                    min={toDateInputValue(new Date())}
                    disabled={saving}
                    onChange={(event) => {
                      clearMessages();
                      setEffectiveFrom(event.target.value);
                    }}
                    className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none [color-scheme:dark] focus:border-[#D6FF3F] disabled:opacity-60"
                  />

                  <p className="mt-3 text-sm leading-relaxed text-[#8A8F94]">
                    Alleen beschikbare slots vanaf deze datum worden vervangen.
                  </p>
                </div>

                <fieldset className="mt-8">
                  <legend className="font-display text-base text-[#FF4B3E]">
                    SPORT
                  </legend>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {(["padel", "tennis"] as Sport[]).map((sport) => (
                      <button
                        key={sport}
                        type="button"
                        disabled={saving}
                        onClick={() => void handleSportChange(sport)}
                        className={`border-2 px-5 py-3 font-display text-sm transition disabled:opacity-60 ${
                          selectedSport === sport
                            ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
                            : "border-white/30 text-white hover:border-white"
                        }`}
                      >
                        {sport.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <fieldset className="mt-8">
                  <legend className="font-display text-base text-[#FF4B3E]">
                    ELKE
                  </legend>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {weekdayOptions.map((weekday) => (
                      <button
                        key={weekday.value}
                        type="button"
                        disabled={saving}
                        onClick={() => {
                          clearMessages();
                          setSelectedWeekday(weekday.value);
                        }}
                        className={`min-w-12 border-2 px-4 py-3 font-display text-sm transition disabled:opacity-60 ${
                          selectedWeekday === weekday.value
                            ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
                            : "border-white/30 text-white hover:border-white"
                        }`}
                      >
                        {weekday.shortLabel}
                      </button>
                    ))}
                  </div>

                  <p className="mt-4 font-display text-sm text-[#D6FF3F]">
                    ELKE {getWeekdayLabel(selectedWeekday)}
                  </p>
                </fieldset>

                <div className="mt-8 grid gap-5 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="start-time"
                      className="mb-2 block font-display text-base text-[#FF4B3E]"
                    >
                      VAN (PER KWARTIER)
                    </label>

                    <input
                      id="start-time"
                      type="time"
                      step={900}
                      value={startTime}
                      disabled={saving}
                      onChange={(event) => {
                        if (isQuarterHour(event.target.value)) {
                          clearMessages();
                          setStartTime(event.target.value);
                        }
                      }}
                      className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none [color-scheme:dark] focus:border-[#D6FF3F] disabled:opacity-60"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="end-time"
                      className="mb-2 block font-display text-base text-[#FF4B3E]"
                    >
                      TOT (PER KWARTIER)
                    </label>

                    <input
                      id="end-time"
                      type="time"
                      step={900}
                      value={endTime}
                      disabled={saving}
                      onChange={(event) => {
                        if (isQuarterHour(event.target.value)) {
                          clearMessages();
                          setEndTime(event.target.value);
                        }
                      }}
                      className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none [color-scheme:dark] focus:border-[#D6FF3F] disabled:opacity-60"
                    />
                  </div>
                </div>

                <fieldset className="mt-8">
                  <legend className="font-display text-base text-[#FF4B3E]">
                    DUUR PER LES
                  </legend>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {durationOptions.map((duration) => (
                      <button
                        key={duration}
                        type="button"
                        disabled={saving}
                        onClick={() => {
                          clearMessages();
                          setSelectedDuration(duration);
                        }}
                        className={`border-2 px-4 py-3 font-display text-sm transition disabled:opacity-60 ${
                          selectedDuration === duration
                            ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
                            : "border-white/30 text-white hover:border-white"
                        }`}
                      >
                        {duration} MIN
                      </button>
                    ))}
                  </div>
                </fieldset>

                <div className="mt-8">
                  <label
                    htmlFor="venue-search"
                    className="mb-2 block font-display text-base text-[#FF4B3E]"
                  >
                    TRAININGSLOCATIE
                  </label>

                  <div className="relative">
                    <div className="flex border-2 border-white/25 focus-within:border-[#D6FF3F]">
                      <span className="flex items-center border-r-2 border-white/25 px-4 text-lg text-[#D6FF3F]">
                        ⌕
                      </span>

                      <input
                        id="venue-search"
                        type="search"
                        value={venueSearch}
                        disabled={venuesLoading || saving}
                        placeholder={
                          venuesLoading
                            ? "Locaties laden..."
                            : "Zoek op stad of clubnaam"
                        }
                        onFocus={() => {
                          if (!venuesLoading && !saving) {
                            setVenuePickerOpen(true);
                          }
                        }}
                        onChange={(event) =>
                          handleVenueSearchChange(event.target.value)
                        }
                        className="w-full bg-transparent px-4 py-4 text-white outline-none placeholder:text-[#8A8F94] disabled:opacity-60"
                      />

                      {selectedVenueId ? (
                        <button
                          type="button"
                          onClick={clearVenueSelection}
                          disabled={saving}
                          className="border-l-2 border-white/25 px-4 font-display text-sm text-white transition hover:bg-[#FF4B3E]"
                        >
                          WIS
                        </button>
                      ) : null}
                    </div>

                    {venuePickerOpen && !venuesLoading && !saving ? (
                      <div className="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto border-2 border-[#D6FF3F] bg-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]">
                        {filteredVenues.length === 0 ? (
                          <p className="p-5 text-sm text-[#B9BEC2]">
                            Geen {selectedSport}locaties gevonden.
                          </p>
                        ) : (
                          filteredVenues.map((venue) => (
                            <button
                              key={venue.id}
                              type="button"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => handleVenueSelect(venue)}
                              className="group block w-full border-b border-white/15 px-5 py-4 text-left transition last:border-b-0 hover:bg-[#D6FF3F] hover:text-[#14171A]"
                            >
                              <span className="block font-display text-base">
                                {getVenueLabel(venue)}
                              </span>

                              <span className="mt-1 block text-sm opacity-75">
                                {venue.address_line}
                                {venue.postal_code
                                  ? ` · ${venue.postal_code}`
                                  : ""}
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    ) : null}
                  </div>

                  {selectedVenue ? (
                    <div className="mt-4 border-l-2 border-[#D6FF3F] bg-white/5 p-4">
                      <p className="font-display text-base">
                        {getVenueLabel(selectedVenue)}
                      </p>

                      <p className="mt-2 text-sm text-[#B9BEC2]">
                        {selectedVenue.address_line}
                        <br />
                        {selectedVenue.postal_code
                          ? `${selectedVenue.postal_code} `
                          : ""}
                        {selectedVenue.city}
                      </p>

                      {formatCourtEnvironment(
                        selectedVenue.court_environment
                      ) ? (
                        <p className="mt-3 font-display text-xs text-[#D6FF3F]">
                          {formatCourtEnvironment(
                            selectedVenue.court_environment
                          )}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <fieldset className="mt-8">
                  <legend className="font-display text-base text-[#FF4B3E]">
                    MAXIMAAL AANTAL SPELERS
                  </legend>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {participantOptions.map((count) => (
                      <button
                        key={count}
                        type="button"
                        disabled={saving}
                        onClick={() => {
                          clearMessages();
                          setMaxParticipants(count);
                        }}
                        className={`border-2 px-4 py-3 font-display text-sm transition disabled:opacity-60 ${
                          maxParticipants === count
                            ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
                            : "border-white/30 text-white hover:border-white"
                        }`}
                      >
                        {count} {count === 1 ? "SPELER" : "SPELERS"}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <div className="mt-8">
                  <label
                    htmlFor="price"
                    className="mb-2 block font-display text-base text-[#FF4B3E]"
                  >
                    TOTAALPRIJS INCLUSIEF BAANHUUR
                  </label>

                  <div className="flex border-2 border-white/25 focus-within:border-[#D6FF3F]">
                    <span className="flex items-center border-r-2 border-white/25 px-4 font-display text-xl text-[#D6FF3F]">
                      €
                    </span>

                    <input
                      id="price"
                      type="number"
                      inputMode="decimal"
                      min="1"
                      step="0.01"
                      value={price}
                      disabled={saving}
                      onChange={(event) => {
                        clearMessages();
                        setPrice(event.target.value);
                      }}
                      className="w-full bg-transparent px-4 py-4 text-white outline-none disabled:opacity-60"
                    />
                  </div>
                </div>

                <div className="mt-10 border-2 border-white/25 bg-white/5">
                  <div className="border-b-2 border-white/15 px-5 py-4 sm:px-6">
                    <p className="font-display text-sm text-[#D6FF3F]">
                      CONTROLEER JE WIJZIGING
                    </p>

                    <p className="mt-1 text-sm text-[#B9BEC2]">
                      Alleen toekomstige beschikbare slots worden aangepast.
                    </p>
                  </div>

                  <div className="p-5 sm:p-6">
                    <div className="flex flex-col gap-4 border-b-2 border-white/15 pb-5 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <p className="font-display text-xl sm:text-2xl">
                          ELKE {getWeekdayLabel(selectedWeekday)}
                        </p>

                        <p className="mt-1 text-sm font-semibold uppercase tracking-wide text-[#8A8F94]">
                          {selectedSport}training
                        </p>
                      </div>

                      <p className="font-display text-4xl text-[#D6FF3F] sm:text-5xl">
                        {startTime}
                        <span className="mx-2 text-white/35">–</span>
                        {endTime}
                      </p>
                    </div>

                    <div className="grid gap-4 border-b-2 border-white/15 py-5 sm:grid-cols-3">
                      <div>
                        <p className="font-display text-xs text-[#8A8F94]">
                          DUUR
                        </p>
                        <p className="mt-2 font-display text-xl">
                          {selectedDuration} MIN
                        </p>
                      </div>

                      <div>
                        <p className="font-display text-xs text-[#8A8F94]">
                          GROEP
                        </p>
                        <p className="mt-2 font-display text-xl">
                          MAX. {maxParticipants}
                        </p>
                      </div>

                      <div>
                        <p className="font-display text-xs text-[#8A8F94]">
                          TOTAALPRIJS
                        </p>
                        <p className="mt-2 font-display text-xl text-[#D6FF3F]">
                          {formattedPrice}
                        </p>
                      </div>
                    </div>

                    <div className="border-b-2 border-white/15 py-5">
                      <p className="font-display text-xs text-[#8A8F94]">
                        BOEKBARE LESSEN
                      </p>

                      <p className="mt-2 text-sm font-semibold text-white">
                        Elke {getWeekdayLabel(selectedWeekday).toLowerCase()}{" "}
                        staan er maximaal{" "}
                        <span className="font-display text-[#D6FF3F]">
                          {possibleSlots}{" "}
                          {possibleSlots === 1 ? "LES" : "LESSEN"}
                        </span>{" "}
                        van {selectedDuration} minuten open.
                      </p>
                    </div>

                    <div className="pt-5">
                      <p className="font-display text-xs text-[#8A8F94]">
                        LOCATIE
                      </p>

                      {selectedVenue ? (
                        <div className="mt-3 flex items-start gap-3">
                          <div className="mt-1 h-3 w-3 shrink-0 bg-[#FF4B3E]" />

                          <div>
                            <p className="font-display text-lg">
                              {getVenueLabel(selectedVenue)}
                            </p>

                            <p className="mt-2 text-sm text-[#B9BEC2]">
                              {selectedVenue.address_line}
                              <br />
                              {selectedVenue.postal_code
                                ? `${selectedVenue.postal_code} `
                                : ""}
                              {selectedVenue.city}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <p className="mt-3 text-sm text-[#B9BEC2]">
                          Kies nog een trainingslocatie.
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={
                    saving ||
                    !trainerIsActive ||
                    venuesLoading ||
                    possibleSlots === 0
                  }
                  className="mt-8 flex w-full items-center justify-center gap-3 bg-[#FF4B3E] px-6 py-5 font-display text-xl text-white transition hover:-translate-y-1 hover:bg-white hover:text-[#14171A] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving
                    ? "WIJZIGING OPSLAAN..."
                    : "WIJZIGING OPSLAAN. GOW!"}

                  {!saving ? <span aria-hidden="true">→</span> : null}
                </button>
              </div>
            </div>
          </form>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}