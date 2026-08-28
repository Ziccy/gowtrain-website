"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SiteFooter from "@/components/SiteFooter";
import { supabase } from "@/lib/supabase-browser";

type TrainerAccount = {
  id: string;
  is_active: boolean;
  approval_status: "pending" | "approved" | "rejected";
};

type TrainingLocation = {
  id: string;
  name: string;
  address_line: string;
  postal_code: string | null;
  city: string;
  country_code: string;
  created_at: string;
};

export default function TrainerLocatiesPage() {
  const router = useRouter();

  const [trainerAccount, setTrainerAccount] =
    useState<TrainerAccount | null>();

  const [locations, setLocations] = useState<TrainingLocation[]>([]);

  const [name, setName] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [city, setCity] = useState("");
  const [countryCode, setCountryCode] = useState("NL");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingLocationId, setDeletingLocationId] = useState<string | null>(
    null
  );

  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  function clearMessages(): void {
    setErrorMessage("");
    setSuccessMessage("");
  }

  function showError(message: string): void {
    setSuccessMessage("");
    setErrorMessage(message);
  }

  async function loadPage(): Promise<void> {
    setLoading(true);
    clearMessages();

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        router.replace("/trainer-login");
        return;
      }

      const { data: trainerData, error: trainerError } = await supabase
        .from("trainers")
        .select("id, is_active, approval_status")
        .eq("user_id", user.id)
        .single();

      if (trainerError || !trainerData) {
        console.error("Trainer ophalen fout:", trainerError?.message);
        showError("Je trainerprofiel kon niet worden geladen.");
        return;
      }

      const trainer = trainerData as TrainerAccount;

      setTrainerAccount(trainer);

      const { data: locationData, error: locationError } = await supabase
        .from("training_locations")
        .select(
          "id, name, address_line, postal_code, city, country_code, created_at"
        )
        .eq("trainer_id", trainer.id)
        .order("name", { ascending: true });

      if (locationError) {
        console.error("Locaties ophalen fout:", locationError.message);
        showError("Je locaties konden niet worden geladen.");
        return;
      }

      setLocations((locationData ?? []) as TrainingLocation[]);
    } catch (error) {
      console.error("Onverwachte locaties-fout:", error);
      showError("Er ging iets mis bij het laden van je locaties.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPage();
  }, []);

  async function handleAddLocation(
    event: FormEvent<HTMLFormElement>
  ): Promise<void> {
    event.preventDefault();
    clearMessages();

    if (!trainerAccount) {
      showError("Je trainerprofiel kon niet worden geladen.");
      return;
    }

    if (
      trainerAccount.approval_status !== "approved" ||
      !trainerAccount.is_active
    ) {
      showError(
        "Je profiel is nog niet actief. Je kunt pas locaties toevoegen nadat je profiel is goedgekeurd."
      );
      return;
    }

    if (!name.trim() || !addressLine.trim() || !city.trim()) {
      showError("Vul de locatienaam, het adres en de plaats in.");
      return;
    }

    setSaving(true);

    try {
      const { data, error } = await supabase
        .from("training_locations")
        .insert({
          trainer_id: trainerAccount.id,
          name: name.trim(),
          address_line: addressLine.trim(),
          postal_code: postalCode.trim() || null,
          city: city.trim(),
          country_code: countryCode.trim().toUpperCase() || "NL",
        })
        .select(
          "id, name, address_line, postal_code, city, country_code, created_at"
        )
        .single();

      if (error || !data) {
        console.error("Locatie toevoegen fout:", error?.message);
        showError("Je locatie kon niet worden opgeslagen. Probeer het opnieuw.");
        return;
      }

      setLocations((currentLocations) =>
        [...currentLocations, data as TrainingLocation].sort((a, b) =>
          a.name.localeCompare(b.name, "nl")
        )
      );

      setName("");
      setAddressLine("");
      setPostalCode("");
      setCity("");
      setCountryCode("NL");

      setSuccessMessage("Locatie toegevoegd. Je kunt deze nu aan een tijdslot koppelen.");
    } catch (error) {
      console.error("Onverwachte locatie-toevoegfout:", error);
      showError("Je locatie kon niet worden opgeslagen. Probeer het opnieuw.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteLocation(location: TrainingLocation): Promise<void> {
    clearMessages();

    const confirmed = window.confirm(
      `Weet je zeker dat je "${location.name}" wilt verwijderen?`
    );

    if (!confirmed) {
      return;
    }

    setDeletingLocationId(location.id);

    try {
      const { error } = await supabase
        .from("training_locations")
        .delete()
        .eq("id", location.id);

      if (error) {
        console.error("Locatie verwijderen fout:", error.message);

        if (
          error.message.toLowerCase().includes("foreign key") ||
          error.message.toLowerCase().includes("violates")
        ) {
          showError(
            "Deze locatie is gekoppeld aan een tijdslot en kan daarom niet worden verwijderd."
          );
        } else {
          showError("Je locatie kon niet worden verwijderd. Probeer het opnieuw.");
        }

        return;
      }

      setLocations((currentLocations) =>
        currentLocations.filter((item) => item.id !== location.id)
      );

      setSuccessMessage("Locatie verwijderd.");
    } catch (error) {
      console.error("Onverwachte locatie-verwijderfout:", error);
      showError("Je locatie kon niet worden verwijderd. Probeer het opnieuw.");
    } finally {
      setDeletingLocationId(null);
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
            LOCATIES LADEN...
          </p>
        </div>
      </main>
    );
  }

  const trainerIsActive =
    trainerAccount?.approval_status === "approved" &&
    trainerAccount.is_active;

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      <header className="border-b border-white/15">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
          <a
            href="/trainer-slots"
            className="group inline-flex items-center gap-2"
            aria-label="Terug naar mijn slots"
          >
            <span className="font-display text-3xl leading-none text-[#D6FF3F] sm:text-4xl">
              GOWTRAIN
            </span>

            <span className="mt-1 h-0 w-0 border-b-[9px] border-l-[8px] border-t-[9px] border-b-transparent border-l-[#D6FF3F] border-t-transparent transition-transform group-hover:translate-x-1" />
          </a>

          <div className="flex items-center gap-3">
            <a
              href="/trainer-slots"
              className="hidden font-display text-sm text-white transition hover:text-[#D6FF3F] sm:block"
            >
              ← MIJN SLOTS
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

      <section className="flex-1 py-12 sm:py-16">
        <div className="mx-auto max-w-4xl px-5 sm:px-8">
          <div className="border-b-2 border-white/20 pb-8">
            <p className="font-display text-lg text-[#FF4B3E]">
              TRAININGSLOCATIES
            </p>

            <h1 className="mt-3 font-display text-5xl leading-[0.83] sm:text-6xl">
              MIJN
              <br />
              LOCATIES.
            </h1>

            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-[#D7D9DA]">
              Voeg de clubs en banen toe waar jij lesgeeft. Daarna kies je
              eenvoudig de juiste locatie bij elk tijdslot.
            </p>
          </div>

          {!trainerIsActive ? (
            <div className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] px-5 py-4">
              <p className="font-display text-lg">
                JE PROFIEL IS NOG NIET ACTIEF.
              </p>
              <p className="mt-2 text-white/90">
                Je kunt locaties toevoegen zodra je trainerprofiel is goedgekeurd.
              </p>
            </div>
          ) : null}

          {errorMessage ? (
            <div
              role="alert"
              className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] px-5 py-4 font-semibold"
            >
              {errorMessage}
            </div>
          ) : null}

          {successMessage ? (
            <div
              role="status"
              className="mt-8 border-2 border-[#D6FF3F] bg-[#D6FF3F] px-5 py-4 font-semibold text-[#14171A]"
            >
              {successMessage}
            </div>
          ) : null}

          <form
            onSubmit={handleAddLocation}
            className="mt-8 border-2 border-white bg-white p-3 text-[#14171A] shadow-[8px_8px_0_0_#FF4B3E]"
          >
            <div className="bg-[#14171A] p-5 text-white sm:p-8">
              <p className="font-display text-xl text-[#D6FF3F]">
                NIEUWE LOCATIE.
              </p>

              <div className="mt-6">
                <label
                  htmlFor="location-name"
                  className="mb-2 block font-display text-base text-[#FF4B3E]"
                >
                  NAAM CLUB OF LOCATIE
                </label>

                <input
                  id="location-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Bijv. Peakz Padel Utrecht"
                  disabled={!trainerIsActive || saving}
                  className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none placeholder:text-[#8A8F94] focus:border-[#D6FF3F]"
                />
              </div>

              <div className="mt-6">
                <label
                  htmlFor="address-line"
                  className="mb-2 block font-display text-base text-[#FF4B3E]"
                >
                  ADRES
                </label>

                <input
                  id="address-line"
                  value={addressLine}
                  onChange={(event) => setAddressLine(event.target.value)}
                  placeholder="Bijv. Mississippidreef 87"
                  disabled={!trainerIsActive || saving}
                  className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none placeholder:text-[#8A8F94] focus:border-[#D6FF3F]"
                />
              </div>

              <div className="mt-6 grid gap-6 sm:grid-cols-3">
                <div>
                  <label
                    htmlFor="postal-code"
                    className="mb-2 block font-display text-base text-[#FF4B3E]"
                  >
                    POSTCODE
                  </label>

                  <input
                    id="postal-code"
                    value={postalCode}
                    onChange={(event) => setPostalCode(event.target.value)}
                    placeholder="1234 AB"
                    disabled={!trainerIsActive || saving}
                    className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none placeholder:text-[#8A8F94] focus:border-[#D6FF3F]"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label
                    htmlFor="city"
                    className="mb-2 block font-display text-base text-[#FF4B3E]"
                  >
                    PLAATS
                  </label>

                  <input
                    id="city"
                    value={city}
                    onChange={(event) => setCity(event.target.value)}
                    placeholder="Bijv. Utrecht"
                    disabled={!trainerIsActive || saving}
                    className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none placeholder:text-[#8A8F94] focus:border-[#D6FF3F]"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={!trainerIsActive || saving}
                className="mt-8 flex w-full items-center justify-center bg-[#FF4B3E] px-6 py-5 font-display text-xl text-white transition hover:bg-white hover:text-[#14171A] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "LOCATIE OPSLAAN..." : "LOCATIE TOEVOEGEN. GOW!"}
              </button>
            </div>
          </form>

          <div className="mt-12">
            <p className="font-display text-xl text-[#D6FF3F]">
              OPGESLAGEN LOCATIES.
            </p>

            {locations.length === 0 ? (
              <div className="mt-4 border-2 border-white/20 px-5 py-6 text-[#B9BEC2]">
                Je hebt nog geen trainingslocaties toegevoegd.
              </div>
            ) : (
              <div className="mt-4 grid gap-4">
                {locations.map((location) => (
                  <article
                    key={location.id}
                    className="border-2 border-white bg-white p-5 text-[#14171A]"
                  >
                    <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
                      <div>
                        <h2 className="font-display text-2xl">
                          {location.name}
                        </h2>

                        <p className="mt-2 text-[#4E5459]">
                          {location.address_line}
                          <br />
                          {location.postal_code ? `${location.postal_code} ` : ""}
                          {location.city}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => void handleDeleteLocation(location)}
                        disabled={deletingLocationId === location.id}
                        className="border-2 border-[#14171A] px-4 py-2 font-display text-sm transition hover:border-[#FF4B3E] hover:bg-[#FF4B3E] hover:text-white disabled:opacity-50"
                      >
                        {deletingLocationId === location.id
                          ? "VERWIJDEREN..."
                          : "VERWIJDER"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}