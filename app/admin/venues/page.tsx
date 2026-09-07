"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { supabase } from "@/lib/supabase-browser";

type CourtEnvironment = "indoor" | "outdoor" | "indoor_outdoor";

type VenueItem = {
  id: string;
  name: string;
  address_line: string;
  postal_code: string | null;
  city: string;
  province: string | null;
  country_code: string;
  sports: string[];
  court_environment: CourtEnvironment | null;
  court_count: number | null;
  is_active: boolean;
  created_at: string;
};

type VenueFilterStatus = "all" | "active" | "inactive";

export default function AdminVenuesPage() {
  const router = useRouter();

  const [venues, setVenues] = useState<VenueItem[]>([]);
  const [filterStatus, setFilterStatus] = useState<VenueFilterStatus>("active");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [editingVenueId, setEditingVenueId] = useState<string | null>(null);

  // Formulier state
  const [showForm, setShowForm] = useState<boolean>(false);
  const [name, setName] = useState<string>("");
  const [addressLine, setAddressLine] = useState<string>("");
  const [postalCode, setPostalCode] = useState<string>("");
  const [city, setCity] = useState<string>("");
  const [province, setProvince] = useState<string>("");
  const [sportsPadel, setSportsPadel] = useState<boolean>(true);
  const [sportsTennis, setSportsTennis] = useState<boolean>(true);
  const [courtEnvironment, setCourtEnvironment] = useState<CourtEnvironment>("indoor_outdoor");
  const [courtCount, setCourtCount] = useState<string>("8");

  const [errorMessage, setErrorMessage] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");

  useEffect(() => {
    void verifyAdminAndLoadVenues();
  }, []);

  function clearMessages(): void {
    setErrorMessage("");
    setSuccessMessage("");
  }

  function showError(message: string): void {
    setSuccessMessage("");
    setErrorMessage(message);
  }

  async function verifyAdminAndLoadVenues(): Promise<void> {
    setLoading(true);
    clearMessages();

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        router.replace("/speler-login");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", session.user.id)
        .maybeSingle();

      if (profile?.role !== "admin") {
        await supabase.auth.signOut();
        router.replace("/speler-login");
        return;
      }

      await loadVenues();
    } catch {
      showError("Toegang kon niet worden geverifieerd.");
    } finally {
      setLoading(false);
    }
  }

  async function loadVenues(): Promise<void> {
    const { data, error } = await supabase
      .from("venues")
      .select("*")
      .order("city", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      showError("Locaties konden niet worden geladen.");
      return;
    }

    setVenues((data ?? []) as VenueItem[]);
  }

  function resetForm(): void {
    setEditingVenueId(null);
    setName("");
    setAddressLine("");
    setPostalCode("");
    setCity("");
    setProvince("");
    setSportsPadel(true);
    setSportsTennis(true);
    setCourtEnvironment("indoor_outdoor");
    setCourtCount("8");
    setShowForm(false);
  }

  function openEditForm(venue: VenueItem): void {
    clearMessages();
    setEditingVenueId(venue.id);
    setName(venue.name);
    setAddressLine(venue.address_line);
    setPostalCode(venue.postal_code || "");
    setCity(venue.city);
    setProvince(venue.province || "");
    setSportsPadel(venue.sports.includes("padel"));
    setSportsTennis(venue.sports.includes("tennis"));
    setCourtEnvironment(venue.court_environment || "indoor_outdoor");
    setCourtCount(venue.court_count ? String(venue.court_count) : "");
    setShowForm(true);

    window.scrollTo({ top: 250, behavior: "smooth" });
  }

  async function handleSaveVenue(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    clearMessages();

    if (!name.trim()) {
      showError("Vul de clubnaam in.");
      return;
    }
    if (!addressLine.trim() || !city.trim()) {
      showError("Vul adres en stad in.");
      return;
    }
    if (!sportsPadel && !sportsTennis) {
      showError("Selecteer minimaal 1 sport (Padel of Tennis).");
      return;
    }

    const selectedSports: string[] = [];
    if (sportsPadel) selectedSports.push("padel");
    if (sportsTennis) selectedSports.push("tennis");

    setSaving(true);

    try {
      const payload = {
        name: name.trim(),
        address_line: addressLine.trim(),
        postal_code: postalCode.trim() || null,
        city: city.trim(),
        province: province.trim() || null,
        sports: selectedSports,
        court_environment: courtEnvironment,
        court_count: courtCount ? Number(courtCount) : null,
      };

      if (editingVenueId) {
        const { error: updateError } = await supabase
          .from("venues")
          .update(payload)
          .eq("id", editingVenueId);

        if (updateError) {
          showError(`Opslaan mislukt: ${updateError.message}`);
          return;
        }

        setSuccessMessage(`Locatie '${name.toUpperCase()}' is succesvol bijgewerkt!`);
      } else {
        const { error: insertError } = await supabase
          .from("venues")
          .insert({
            ...payload,
            country_code: "NL",
            is_active: true,
          });

        if (insertError) {
          showError(`Toevoegen mislukt: ${insertError.message}`);
          return;
        }

        setSuccessMessage(`Nieuwe locatie '${name.toUpperCase()}' toegevoegd!`);
      }

      resetForm();
      await loadVenues();
    } catch {
      showError("Opslaan mislukt.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleVenueActive(venue: VenueItem): Promise<void> {
    clearMessages();
    const nextState = !venue.is_active;

    try {
      const { error } = await supabase
        .from("venues")
        .update({ is_active: nextState })
        .eq("id", venue.id);

      if (error) {
        showError("Status kon niet worden gewijzigd.");
        return;
      }

      setSuccessMessage(
        nextState
          ? `Locatie '${venue.name}' is weer GEACTIVEERD.`
          : `Locatie '${venue.name}' is GEARCHIVEERD/DEGEACTIVEERD.`
      );

      await loadVenues();
    } catch {
      showError("Status kon niet worden gewijzigd.");
    }
  }

  const filteredVenues = useMemo(() => {
    return venues.filter((venue) => {
      if (filterStatus === "active" && !venue.is_active) return false;
      if (filterStatus === "inactive" && venue.is_active) return false;

      if (!searchQuery.trim()) return true;

      const q = searchQuery.trim().toLowerCase();
      const searchable = [venue.name, venue.city, venue.address_line, venue.province ?? ""]
        .join(" ")
        .toLowerCase();

      return searchable.includes(q);
    });
  }, [venues, filterStatus, searchQuery]);

  if (loading) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-[#14171A] px-5 text-white">
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-2">
            <span className="font-display text-5xl text-[#D6FF3F]">GOWTRAIN</span>
            <span className="h-0 w-0 animate-pulse border-b-[14px] border-l-[12px] border-t-[14px] border-b-transparent border-l-[#D6FF3F] border-t-transparent" />
          </div>
          <p className="mt-4 font-display text-sm tracking-widest text-[#FF4B3E]">LOCATIES LADEN...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      {/* 💡 UNIVERSELE DYNAMISCHE SITE HEADER */}
      <SiteHeader />

      {/* CONTENT */}
      <section className="relative flex-1 overflow-hidden py-10 sm:py-14">
        <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
          
          <div className="flex flex-col justify-between gap-6 border-b-2 border-white/20 pb-8 md:flex-row md:items-end">
            <div>
              <p className="font-display text-lg text-[#FF4B3E]">ADMIN / LOCATIES</p>
              <h1 className="mt-3 font-display text-5xl leading-[0.83] sm:text-6xl lg:text-7xl">
                BEHEER CLUBS<br />&amp; LOCATIES.
              </h1>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/admin"
                className="inline-flex border-2 border-white px-4 py-2.5 font-display text-xs text-white hover:border-[#D6FF3F] hover:text-[#D6FF3F] transition"
              >
                ← ADMIN HUB
              </Link>

              <button
                type="button"
                onClick={() => { clearMessages(); resetForm(); setShowForm(!showForm); }}
                className="bg-[#D6FF3F] px-5 py-3 font-display text-base !text-[#14171A] transition hover:bg-white shadow-[4px_4px_0_0_#FF4B3E]"
              >
                {showForm ? "✕ SLUIT FORMULIER" : "+ NIEUWE LOCATIE TOEVOEGEN"}
              </button>
            </div>
          </div>

          {errorMessage && <div role="alert" className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] px-5 py-4 font-semibold text-white">{errorMessage}</div>}
          {successMessage && <div role="status" className="mt-8 border-2 border-[#D6FF3F] bg-[#D6FF3F] px-5 py-4 font-semibold text-[#14171A] shadow-[8px_8px_0_0_#FF4B3E]">{successMessage}</div>}

          {/* FORMULIER VOOR TOEVOEGEN / BEWERKEN */}
          {showForm && (
            <form onSubmit={handleSaveVenue} className="mt-8 border-2 border-white bg-white p-3 text-[#14171A] shadow-[8px_8px_0_0_#D6FF3F]">
              <div className="bg-[#14171A] p-6 text-white space-y-6">
                <p className="font-display text-2xl text-[#D6FF3F]">
                  {editingVenueId ? "LOCATIE BEWERKEN" : "NIEUWE TRAININGSLOCATIE TOEVOEGEN"}
                </p>

                <div className="grid gap-6 sm:grid-cols-2">
                  <div>
                    <label className="block font-display text-xs text-[#FF4B3E] mb-2">CLUBNAAM</label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Bijv. Tennisclub Maasniel"
                      className="w-full border-2 border-white/25 bg-transparent p-3 text-white outline-none focus:border-[#D6FF3F]"
                    />
                  </div>

                  <div>
                    <label className="block font-display text-xs text-[#FF4B3E] mb-2">STAD / GEMEENTE</label>
                    <input
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="Bijv. Roermond"
                      className="w-full border-2 border-white/25 bg-transparent p-3 text-white outline-none focus:border-[#D6FF3F]"
                    />
                  </div>

                  <div>
                    <label className="block font-display text-xs text-[#FF4B3E] mb-2">STRAAT &amp; HUISNUMMER</label>
                    <input
                      type="text"
                      value={addressLine}
                      onChange={(e) => setAddressLine(e.target.value)}
                      placeholder="Bijv. Sportlaan 10"
                      className="w-full border-2 border-white/25 bg-transparent p-3 text-white outline-none focus:border-[#D6FF3F]"
                    />
                  </div>

                  <div>
                    <label className="block font-display text-xs text-[#FF4B3E] mb-2">PROVINCIE</label>
                    <input
                      type="text"
                      value={province}
                      onChange={(e) => setProvince(e.target.value)}
                      placeholder="Bijv. Limburg"
                      className="w-full border-2 border-white/25 bg-transparent p-3 text-white outline-none focus:border-[#D6FF3F]"
                    />
                  </div>
                </div>

                <div className="grid gap-6 sm:grid-cols-3">
                  <div>
                    <label className="block font-display text-xs text-[#FF4B3E] mb-2">GESCHIKT VOOR SPORTEN</label>
                    <div className="flex gap-4 items-center mt-2">
                      <label className="flex items-center gap-2 cursor-pointer font-display text-sm">
                        <input
                          type="checkbox"
                          checked={sportsPadel}
                          onChange={(e) => setSportsPadel(e.target.checked)}
                          className="h-5 w-5 accent-[#D6FF3F]"
                        />
                        PADEL
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer font-display text-sm">
                        <input
                          type="checkbox"
                          checked={sportsTennis}
                          onChange={(e) => setSportsTennis(e.target.checked)}
                          className="h-5 w-5 accent-[#D6FF3F]"
                        />
                        TENNIS
                      </label>
                    </div>
                  </div>

                  <div>
                    <label className="block font-display text-xs text-[#FF4B3E] mb-2">ACCOMMODATIE</label>
                    <select
                      value={courtEnvironment}
                      onChange={(e) => setCourtEnvironment(e.target.value as CourtEnvironment)}
                      className="w-full border-2 border-white/25 bg-[#14171A] p-3 text-white outline-none focus:border-[#D6FF3F]"
                    >
                      <option value="indoor_outdoor">BINNEN &amp; BUITEN</option>
                      <option value="indoor">ALLEEN BINNEN (INDOOR)</option>
                      <option value="outdoor">ALLEEN BUITEN (OUTDOOR)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-display text-xs text-[#FF4B3E] mb-2">AANTAL BANEN</label>
                    <input
                      type="number"
                      min="1"
                      value={courtCount}
                      onChange={(e) => setCourtCount(e.target.value)}
                      placeholder="Bijv. 8"
                      className="w-full border-2 border-white/25 bg-transparent p-3 text-white outline-none focus:border-[#D6FF3F]"
                    />
                  </div>
                </div>

                <div className="flex gap-3 pt-4 border-t border-white/20">
                  <button
                    type="submit"
                    disabled={saving}
                    className="bg-[#FF4B3E] px-6 py-4 font-display text-lg text-white hover:bg-[#D6FF3F] hover:!text-[#14171A]"
                  >
                    {saving ? "OPSLAAN..." : editingVenueId ? "WIJZIGINGEN OPSLAAN →" : "LOCATIE OPSLAAN. GOW! →"}
                  </button>

                  <button
                    type="button"
                    onClick={resetForm}
                    className="border-2 border-white/30 px-5 py-4 font-display text-sm text-white"
                  >
                    ANNULEREN
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* FILTERS & ZOEKBALK */}
          <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b-2 border-white/20 pb-6">
            <div className="flex border-2 border-white/25 transition focus-within:border-[#D6FF3F] sm:w-80">
              <span className="flex items-center px-3 text-lg text-[#D6FF3F]">⌕</span>
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Zoek club, stad of adres..."
                className="w-full bg-transparent py-2.5 pr-3 text-xs text-white outline-none placeholder:text-[#8A8F94]"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["ACTIEF", "active"],
                  ["GEARCHIVEERD", "inactive"],
                  ["ALLES", "all"],
                ] as [string, VenueFilterStatus][]
              ).map(([label, value]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilterStatus(value)}
                  className={`border-2 px-4 py-2 font-display text-xs transition ${
                    filterStatus === value
                      ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
                      : "border-white/30 text-white hover:border-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* LOCATIES OVERZICHT GRID */}
          {filteredVenues.length === 0 ? (
            <div className="mt-8 border-2 border-white/20 p-8 text-center text-[#B9BEC2]">
              Geen locaties gevonden voor deze zoekopdracht.
            </div>
          ) : (
            <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {filteredVenues.map((venue) => (
                <article key={venue.id} className="border-2 border-white bg-white p-3 text-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]">
                  <div className="bg-[#14171A] p-5 text-white flex flex-col justify-between h-full">
                    <div>
                      <div className="flex justify-between items-start gap-3">
                        <div>
                          <p className="font-display text-xs text-[#D6FF3F]">{venue.city.toUpperCase()}</p>
                          <h3 className="font-display text-2xl mt-0.5">{venue.name}</h3>
                        </div>

                        <span className={`px-2.5 py-1 font-display text-[10px] ${venue.is_active ? "bg-[#D6FF3F] text-[#14171A]" : "bg-[#FF4B3E] text-white"}`}>
                          {venue.is_active ? "ACTIEF" : "INACTIEF"}
                        </span>
                      </div>

                      <div className="mt-4 border-y border-white/20 py-3 space-y-1.5 text-xs text-[#B9BEC2]">
                        <p>· {venue.address_line}{venue.postal_code ? `, ${venue.postal_code}` : ""}</p>
                        <p>· {venue.sports.map((s) => s.toUpperCase()).join(" & ")}</p>
                        {venue.court_environment && (
                          <p>
                            · {venue.court_environment === "indoor" ? "Binnen" : venue.court_environment === "outdoor" ? "Buiten" : "Binnen & Buiten"}
                            {venue.court_count ? ` - ${venue.court_count} banen` : ""}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="mt-6 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => openEditForm(venue)}
                        className="border-2 border-white py-2.5 font-display text-xs text-white hover:bg-[#D6FF3F] hover:!text-[#14171A]"
                      >
                        WIJZIGEN
                      </button>

                      <button
                        type="button"
                        onClick={() => void toggleVenueActive(venue)}
                        className={`py-2.5 font-display text-xs transition ${
                          venue.is_active
                            ? "border-2 border-[#FF4B3E] text-[#FF4B3E] hover:bg-[#FF4B3E] hover:text-white"
                            : "bg-[#D6FF3F] text-[#14171A] hover:bg-white"
                        }`}
                      >
                        {venue.is_active ? "DEACTIVEREN" : "ACTIVEER"}
                      </button>
                    </div>

                  </div>
                </article>
              ))}
            </div>
          )}

        </div>
      </section>

      <SiteFooter />
    </main>
  );
}