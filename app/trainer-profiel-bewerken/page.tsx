"use client";

import type { ChangeEvent, FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import SiteFooter from "@/components/SiteFooter";
import { locations, type LocationOption } from "@/constants/locations";
import { supabase } from "@/lib/supabase-browser";

type SportOption = "Padel" | "Tennis" | "Padel & Tennis";

type TrainerProfile = {
  id: string;
  name: string;
  initials: string;
  sport: SportOption;
  focus: string;
  bio: string | null;
  city: string | null;
  province: string | null;
  country_code: string | null;
  latitude: number | null;
  longitude: number | null;
  radius_km: number | null;
  price_per_hour: number;
  image_url: string | null;
};

const radiusOptions: number[] = [10, 25, 50, 100];

function getInitials(name: string): string {
  const parts = name.trim().split(" ").filter(Boolean);

  if (parts.length === 0) return "GT";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function formatLocation(location: LocationOption): string {
  return `${location.city}, ${location.province}`;
}

function getLocationId(location: LocationOption): string {
  return [
    location.city,
    location.province,
    location.countryCode,
    location.latitude,
    location.longitude,
  ].join("|");
}

function findExistingLocation(profile: TrainerProfile): LocationOption | null {
  if (!profile.city) return null;

  const matchingLocation = locations.find((location: LocationOption) => {
    const sameCity =
      location.city.toLocaleLowerCase("nl-NL") ===
      profile.city?.toLocaleLowerCase("nl-NL");

    const sameProvince =
      !profile.province ||
      location.province.toLocaleLowerCase("nl-NL") ===
        profile.province.toLocaleLowerCase("nl-NL");

    return sameCity && sameProvince;
  });

  if (matchingLocation) return matchingLocation;

  if (
    profile.latitude !== null &&
    profile.longitude !== null &&
    profile.province
  ) {
    return {
      city: profile.city,
      province: profile.province,
      municipality: null,
      countryCode: profile.country_code === "BE" ? "BE" : "NL",
      latitude: profile.latitude,
      longitude: profile.longitude,
    };
  }

  return null;
}

export default function TrainerProfielBewerkenPage() {
  const router = useRouter();

  const [trainerId, setTrainerId] = useState<string | null>();

  const [name, setName] = useState<string>("");
  const [sport, setSport] = useState<SportOption>("Padel");
  const [focus, setFocus] = useState<string>("");
  const [bio, setBio] = useState<string>("");
  const [location, setLocation] = useState<LocationOption | null>();
  const [locationQuery, setLocationQuery] = useState<string>("");
  const [showLocationResults, setShowLocationResults] = useState<boolean>(false);
  const [radiusKm, setRadiusKm] = useState<number>(25);
  const [price, setPrice] = useState<string>("");
  const [imageUrl, setImageUrl] = useState<string | null>();

  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [uploadingPhoto, setUploadingPhoto] = useState<boolean>(false);

  const [errorMessage, setErrorMessage] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");

  const locationResults = useMemo((): LocationOption[] => {
    const query = locationQuery.trim().toLocaleLowerCase("nl-NL");
    if (query.length < 2) return [];

    return locations
      .filter((item: LocationOption) => {
        const searchableText = `${item.city} ${item.province} ${item.municipality ?? ""}`.toLocaleLowerCase(
          "nl-NL"
        );
        return searchableText.includes(query);
      })
      .slice(0, 8);
  }, [locationQuery]);

  useEffect(() => {
    void fetchProfile();
  }, []);

  function clearMessages(): void {
    setErrorMessage("");
    setSuccessMessage("");
  }

  function showError(message: string): void {
    setSuccessMessage("");
    setErrorMessage(message);
  }

  async function fetchProfile(): Promise<void> {
    setLoading(true);
    clearMessages();

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        router.replace("/trainer-login");
        return;
      }

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        await supabase.auth.signOut();
        router.replace("/trainer-login");
        return;
      }

      const { data, error } = await supabase
        .from("trainers")
        .select(
          `
            id,
            name,
            initials,
            sport,
            focus,
            bio,
            city,
            province,
            country_code,
            latitude,
            longitude,
            radius_km,
            price_per_hour,
            image_url
          `
        )
        .eq("user_id", user.id)
        .single();

      if (error || !data) {
        console.error("Trainerprofiel ophalen fout:", error?.message);
        showError("Je trainerprofiel kon niet worden geladen.");
        return;
      }

      const profile = data as TrainerProfile;
      const existingLocation = findExistingLocation(profile);

      setTrainerId(profile.id);
      setName(profile.name ?? "");
      setSport(profile.sport ?? "Padel");
      setFocus(profile.focus ?? "");
      setBio(profile.bio ?? "");
      setLocation(existingLocation);
      setLocationQuery(existingLocation ? formatLocation(existingLocation) : "");
      setRadiusKm(profile.radius_km ?? 25);
      setPrice(
        profile.price_per_hour !== null && profile.price_per_hour !== undefined
          ? String(Number(profile.price_per_hour).toFixed(0))
          : ""
      );
      setImageUrl(profile.image_url ?? null);
    } catch (error) {
      console.error("Onverwachte profiel-fout:", error);
      showError("Je trainerprofiel kon niet worden geladen.");
    } finally {
      setLoading(false);
    }
  }

  function handleLocationInput(value: string): void {
    clearMessages();
    setLocationQuery(value);
    setShowLocationResults(true);

    if (location) {
      setLocation(null);
    }
  }

  function selectLocation(selectedLocation: LocationOption): void {
    clearMessages();
    setLocation(selectedLocation);
    setLocationQuery(formatLocation(selectedLocation));
    setShowLocationResults(false);
  }

  async function handlePhotoChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    if (!trainerId) {
      showError("Je trainerprofiel is nog niet geladen.");
      return;
    }

    if (!file.type.startsWith("image/")) {
      showError("Kies een geldig afbeeldingsbestand.");
      return;
    }

    const maxFileSizeInBytes = 5 * 1024 * 1024;
    if (file.size > maxFileSizeInBytes) {
      showError("Kies een foto van maximaal 5 MB.");
      return;
    }

    clearMessages();
    setUploadingPhoto(true);

    try {
      const originalExtension = file.name.split(".").pop()?.toLowerCase();
      const extension =
        originalExtension && /^[a-z0-9]+$/.test(originalExtension)
          ? originalExtension
          : "jpg";

      const filePath = `${trainerId}/${Date.now()}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from("trainer-photos")
        .upload(filePath, file, {
          contentType: file.type,
          upsert: false,
        });

      if (uploadError) {
        console.error("Foto upload fout:", uploadError.message);
        showError("Je foto kon niet worden geüpload.");
        return;
      }

      const { data: publicUrlData } = supabase.storage
        .from("trainer-photos")
        .getPublicUrl(filePath);

      const publicUrl = publicUrlData.publicUrl;

      const { error: updateError } = await supabase
        .from("trainers")
        .update({ image_url: publicUrl })
        .eq("id", trainerId);

      if (updateError) {
        console.error("Foto-url opslaan fout:", updateError.message);
        showError("De foto kon niet aan je profiel worden gekoppeld.");
        return;
      }

      setImageUrl(publicUrl);
      setSuccessMessage("Je profielfoto is succesvol bijgewerkt!");
    } catch (error) {
      console.error("Onverwachte foto-upload fout:", error);
      showError("Je foto kon niet worden geüpload.");
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleSave(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    clearMessages();

    if (!trainerId) {
      showError("Je trainerprofiel is nog niet geladen.");
      return;
    }

    if (!name.trim()) {
      showError("Vul je naam in.");
      return;
    }

    if (!focus.trim()) {
      showError("Vul je focus of specialisatie in.");
      return;
    }

    if (!location) {
      showError("Zoek en kies je primaire stad of gemeente uit de suggesties.");
      return;
    }

    if (!price.trim()) {
      showError("Vul je standaardtarief per uur in.");
      return;
    }

    const priceNumber = Number(price.replace(",", "."));
    if (Number.isNaN(priceNumber) || priceNumber <= 0) {
      showError("Vul een geldig standaardtarief in.");
      return;
    }

    setSaving(true);

    try {
      const { error } = await supabase
        .from("trainers")
        .update({
          initials: getInitials(name),
          name: name.trim(),
          sport,
          focus: focus.trim(),
          bio: bio.trim() || null,

          city: location.city,
          province: location.province,
          country_code: location.countryCode,
          latitude: location.latitude,
          longitude: location.longitude,

          radius_km: radiusKm,
          distance_label: `${location.city} · ${radiusKm} KM`,
          price_per_hour: priceNumber,
        })
        .eq("id", trainerId);

      if (error) {
        console.error("Trainerprofiel opslaan fout:", error.message);
        showError("Je profiel kon niet worden opgeslagen.");
        return;
      }

      setSuccessMessage("Je trainerprofiel is opgeslagen! Spelers zien je wijzigingen direct.");
    } catch (error) {
      console.error("Onverwachte opslaan-fout:", error);
      showError("Je profiel kon niet worden opgeslagen.");
    } finally {
      setSaving(false);
    }
  }

  async function handleLogout(): Promise<void> {
    const { error } = await supabase.auth.signOut();
    if (error) {
      showError("Uitloggen lukt nu niet.");
      return;
    }
    router.replace("/trainer-login");
    router.refresh();
  }

  /* BRANDBOOK BRANDED LOADER */
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
            PROFIEL LADEN...
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      {/* HEADER */}
      <header className="border-b border-white/15">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
          <a
            href="/trainer-dashboard"
            aria-label="Terug naar trainerdashboard"
            className="group inline-flex items-center gap-2"
          >
            <span className="font-display text-3xl leading-none text-[#D6FF3F] sm:text-4xl">
              GOWTRAIN
            </span>
            <span className="mt-1 h-0 w-0 border-b-[9px] border-l-[8px] border-t-[9px] border-b-transparent border-l-[#D6FF3F] border-t-transparent transition-transform duration-200 group-hover:translate-x-1 sm:border-b-[11px] sm:border-l-[9px] sm:border-t-[11px]" />
          </a>

          <div className="flex items-center gap-3">
            <a
              href="/trainer-dashboard"
              className="hidden font-display text-sm text-white transition hover:text-[#D6FF3F] sm:block"
            >
              ← DASHBOARD
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

      {/* CONTENT */}
      <section className="relative flex-1 overflow-hidden py-12 sm:py-16">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 -top-16 select-none font-display text-[16rem] leading-none text-[#D6FF3F] opacity-[0.04] sm:text-[25rem]"
        >
          PROFIEL
        </div>

        <div className="relative mx-auto max-w-5xl px-5 sm:px-8">
          <div className="flex flex-col justify-between gap-6 border-b-2 border-white/20 pb-8 md:flex-row md:items-end">
            <div>
              <p className="font-display text-lg text-[#FF4B3E]">TRAINERPROFIEL</p>
              <h1 className="mt-3 font-display text-5xl leading-[0.83] sm:text-6xl lg:text-7xl">
                LAAT JEZELF ZIEN.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-relaxed text-[#D7D9DA]">
                Dit zien spelers wanneer ze jou bekijken en een training bij je willen boeken.
              </p>
            </div>
          </div>

          {errorMessage && (
            <div role="alert" className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] px-5 py-4 font-semibold text-white">
              {errorMessage}
            </div>
          )}

          {successMessage && (
            <div
              role="status"
              className="mt-8 flex flex-col justify-between gap-4 border-2 border-[#D6FF3F] bg-[#D6FF3F] px-5 py-4 text-[#14171A] shadow-[8px_8px_0_0_#FF4B3E] sm:flex-row sm:items-center"
            >
              <p className="font-semibold leading-relaxed">{successMessage}</p>
              <a
                href="/trainer-dashboard"
                className="shrink-0 font-display text-base underline underline-offset-4 transition hover:text-[#FF4B3E]"
              >
                NAAR DASHBOARD →
              </a>
            </div>
          )}

          <form onSubmit={handleSave} className="mt-8 space-y-6">
            
            {/* PROFIELFOTO */}
            <section className="border-2 border-white bg-white p-3 text-[#14171A] shadow-[8px_8px_0_0_#D6FF3F]">
              <div className="bg-[#14171A] p-5 text-white sm:p-7">
                <p className="font-display text-lg text-[#FF4B3E]">PROFIELFOTO</p>

                <div className="mt-5 flex flex-col gap-6 sm:flex-row sm:items-center">
                  <div className="flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[#D6FF3F] bg-[#14171A]">
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={`Profielfoto van ${name || "trainer"}`}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="font-display text-4xl text-[#D6FF3F]">
                        {getInitials(name)}
                      </span>
                    )}
                  </div>

                  <div>
                    <p className="font-display text-2xl text-[#D6FF3F]">JOUW FOTO ON THE COURT.</p>
                    <p className="mt-2 max-w-md text-sm leading-relaxed text-[#B9BEC2]">
                      Een duidelijke profielfoto geeft spelers vertrouwen. Kies bij voorkeur een sportieve foto waarop je gezicht goed zichtbaar is.
                    </p>

                    <label
                      className={`mt-5 inline-flex cursor-pointer items-center justify-center bg-[#FF4B3E] px-5 py-3 font-display text-base text-white transition hover:bg-[#D6FF3F] hover:text-[#14171A] ${
                        uploadingPhoto ? "pointer-events-none cursor-not-allowed opacity-60" : ""
                      }`}
                    >
                      {uploadingPhoto
                        ? "FOTO UPLOADEN..."
                        : imageUrl
                        ? "FOTO WIJZIGEN"
                        : "FOTO TOEVOEGEN"}

                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(event) => void handlePhotoChange(event)}
                        disabled={uploadingPhoto}
                        className="sr-only"
                      />
                    </label>
                  </div>
                </div>
              </div>
            </section>

            {/* BASIS */}
            <section className="border-2 border-white bg-white p-3 text-[#14171A]">
              <div className="bg-[#14171A] p-5 text-white sm:p-7">
                <p className="font-display text-lg text-[#FF4B3E]">BASISGEGEVENS</p>

                <div className="mt-5">
                  <label htmlFor="name" className="mb-2 block font-display text-base text-[#D6FF3F]">
                    NAAM
                  </label>
                  <input
                    id="name"
                    type="text"
                    value={name}
                    onChange={(event) => {
                      clearMessages();
                      setName(event.target.value);
                    }}
                    autoComplete="name"
                    autoCapitalize="words"
                    placeholder="Bijv. Tom Peeters"
                    className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none transition placeholder:text-[#8A8F94] focus:border-[#D6FF3F]"
                  />
                </div>
              </div>
            </section>

            {/* SPORT & FOCUS */}
            <section className="border-2 border-white bg-white p-3 text-[#14171A]">
              <div className="bg-[#14171A] p-5 text-white sm:p-7">
                <p className="font-display text-lg text-[#FF4B3E]">SPORT &amp; SPECIALISATIE</p>

                <fieldset className="mt-5">
                  <legend className="font-display text-base text-[#D6FF3F]">SPORT</legend>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(["Padel", "Tennis", "Padel & Tennis"] as SportOption[]).map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => {
                          clearMessages();
                          setSport(option);
                        }}
                        className={`border-2 px-4 py-3 font-display text-sm transition ${
                          sport === option
                            ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
                            : "border-white/30 text-white hover:border-white"
                        }`}
                      >
                        {option.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <div className="mt-6">
                  <label htmlFor="focus" className="mb-2 block font-display text-base text-[#D6FF3F]">
                    JOUW FOCUS / SPECIALISATIE
                  </label>
                  <input
                    id="focus"
                    type="text"
                    value={focus}
                    onChange={(event) => {
                      clearMessages();
                      setFocus(event.target.value);
                    }}
                    placeholder="Bijv. Tactiek & Gevorderden, Techniek, Beginners"
                    className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none transition placeholder:text-[#8A8F94] focus:border-[#D6FF3F]"
                  />
                  <p className="mt-2 text-xs text-[#8A8F94]">
                    Dit wordt direct getoond op jouw trainerkaart in de zoekresultaten.
                  </p>
                </div>
              </div>
            </section>

            {/* LOCATIE */}
            <section className="border-2 border-white bg-white p-3 text-[#14171A]">
              <div className="bg-[#14171A] p-5 text-white sm:p-7">
                <p className="font-display text-lg text-[#FF4B3E]">LOCATIE &amp; WERKGEBIED</p>

                <div className="relative mt-5">
                  <label htmlFor="location" className="mb-2 block font-display text-base text-[#D6FF3F]">
                    PRIMAIRE STAD OF GEMEENTE
                  </label>

                  <input
                    id="location"
                    type="text"
                    value={locationQuery}
                    onChange={(event) => handleLocationInput(event.target.value)}
                    onFocus={() => setShowLocationResults(true)}
                    placeholder="Zoek op stad of gemeente"
                    autoComplete="off"
                    className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none transition placeholder:text-[#8A8F94] focus:border-[#D6FF3F]"
                  />

                  {location ? (
                    <p className="mt-2 text-sm text-[#D6FF3F]">
                      ✓ Geselecteerd: {formatLocation(location)}
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-[#8A8F94]">
                      Typ minimaal 2 letters en kies een locatie uit de suggesties.
                    </p>
                  )}

                  {showLocationResults && locationQuery.trim().length >= 2 && (
                    <div className="absolute z-30 mt-2 max-h-72 w-full overflow-y-auto border-2 border-[#D6FF3F] bg-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]">
                      {locationResults.length > 0 ? (
                        locationResults.map((option) => (
                          <button
                            key={getLocationId(option)}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => selectLocation(option)}
                            className="block w-full border-b border-white/15 px-4 py-4 text-left text-white transition last:border-b-0 hover:bg-[#D6FF3F] hover:text-[#14171A]"
                          >
                            <span className="block font-semibold">{option.city}</span>
                            <span className="mt-1 block text-sm opacity-70">
                              {option.province}{option.municipality ? ` · ${option.municipality}` : ""}
                            </span>
                          </button>
                        ))
                      ) : (
                        <p className="px-4 py-4 text-sm text-[#B9BEC2]">
                          Geen locatie gevonden. Probeer een andere plaatsnaam.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <fieldset className="mt-7">
                  <legend className="font-display text-base text-[#D6FF3F]">WERKGEBIED / STRADIUS</legend>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {radiusOptions.map((radius) => (
                      <button
                        key={radius}
                        type="button"
                        onClick={() => {
                          clearMessages();
                          setRadiusKm(radius);
                        }}
                        className={`border-2 px-4 py-3 font-display text-sm transition ${
                          radiusKm === radius
                            ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
                            : "border-white/30 text-white hover:border-white"
                        }`}
                      >
                        {radius} KM
                      </button>
                    ))}
                  </div>
                </fieldset>
              </div>
            </section>

            {/* TARIEF */}
            <section className="border-2 border-white bg-white p-3 text-[#14171A]">
              <div className="bg-[#14171A] p-5 text-white sm:p-7">
                <p className="font-display text-lg text-[#FF4B3E]">STANDAARD UURTARIEF</p>

                <div className="mt-5">
                  <label htmlFor="price" className="mb-2 block font-display text-base text-[#D6FF3F]">
                    UURTARIEF (EXCL. BAANHUUR)
                  </label>

                  <div className="flex border-2 border-white/25 transition focus-within:border-[#D6FF3F]">
                    <span className="flex items-center border-r-2 border-white/25 px-4 font-display text-xl text-[#D6FF3F]">
                      €
                    </span>
                    <input
                      id="price"
                      type="number"
                      inputMode="decimal"
                      min="1"
                      step="0.5"
                      value={price}
                      onChange={(event) => {
                        clearMessages();
                        setPrice(event.target.value);
                      }}
                      placeholder="Bijv. 45"
                      className="w-full bg-transparent px-4 py-4 text-white outline-none placeholder:text-[#8A8F94]"
                    />
                  </div>

                  <p className="mt-2 text-xs leading-relaxed text-[#8A8F94]">
                    💡 GowTrain inhoudt automatisch 5% commissie per geboekte les. Je kunt de totaalprijs per los tijdslot (inclusief baanhuur) later nog aanpassen.
                  </p>
                </div>
              </div>
            </section>

            {/* BIO */}
            <section className="border-2 border-white bg-white p-3 text-[#14171A]">
              <div className="bg-[#14171A] p-5 text-white sm:p-7">
                <p className="font-display text-lg text-[#FF4B3E]">BIO &amp; ERVARING</p>

                <div className="mt-5">
                  <label htmlFor="bio" className="mb-2 block font-display text-base text-[#D6FF3F]">
                    VERTEL IETS OVER JE ERVARING EN METHODE
                  </label>

                  <textarea
                    id="bio"
                    value={bio}
                    onChange={(event) => {
                      clearMessages();
                      setBio(event.target.value);
                    }}
                    placeholder="Vertel kort over je achtergrond als speler/trainer, waar je spelers mee helpt en wat jouw manier van lesgeven is."
                    rows={6}
                    className="w-full resize-y border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none transition placeholder:text-[#8A8F94] focus:border-[#D6FF3F]"
                  />
                </div>
              </div>
            </section>

            {/* OPSLAAN */}
            <div className="flex flex-col justify-between gap-5 border-t-2 border-white/20 pt-8 sm:flex-row sm:items-center">
              <p className="max-w-xl text-xs leading-relaxed text-[#B9BEC2]">
                Wijzigingen worden direct zichtbaar op jouw openbare trainerprofiel.
              </p>

              <button
                type="submit"
                disabled={saving || uploadingPhoto}
                className="inline-flex shrink-0 items-center justify-center gap-3 bg-[#FF4B3E] px-7 py-5 font-display text-xl text-white transition hover:-translate-y-1 hover:bg-[#D6FF3F] hover:text-[#14171A] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "OPSLAAN..." : "OPSLAAN. GOW!"}
                {!saving && <span aria-hidden="true">→</span>}
              </button>
            </div>
          </form>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}