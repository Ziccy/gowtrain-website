"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase-browser";

type PackagePurchase = {
  purchaseId: string;
  packageTitle: string;
  lessonCount: number;
  participantCount: number;
  totalPriceCents: number;
  currency: string;
  originalFirstLessonAt: string | null;
  freeCancellationDeadline: string | null;
  canCancel: boolean;
  cancellationMessage: string;
  cancellation: {
    refundStatus: string;
    amountCents: number;
    currency: string;
    applied: boolean;
  } | null;
};

type CancellationResponse = {
  purchase_id: string;
  refund_request_id: string;
  refund_status: string;
  refund_amount_cents: number;
  currency: string;
  message: string;
};

type Props = {
  refreshing?: boolean;
  onChanged: () => void | Promise<void>;
};

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function formatDateTime(value: string | null): string {
  if (!value) return "Niet vastgelegd";

  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return "Niet vastgelegd";
  }

  return new Intl.DateTimeFormat("nl-NL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Amsterdam",
  }).format(date);
}

function canCancelNow(
  purchase: PackagePurchase,
  now: number
): boolean {
  if (
    !purchase.canCancel ||
    purchase.cancellation ||
    !purchase.freeCancellationDeadline
  ) {
    return false;
  }

  const deadline = Date.parse(
    purchase.freeCancellationDeadline
  );

  return Number.isFinite(deadline) && now <= deadline;
}

function getRefundLabel(
  cancellation: NonNullable<PackagePurchase["cancellation"]>
): string {
  if (
    cancellation.refundStatus === "succeeded" &&
    cancellation.applied
  ) {
    return "TERUGBETALING VERWERKT";
  }

  switch (cancellation.refundStatus) {
    case "queued":
      return "TERUGBETALING KLAARGEZET";
    case "processing":
    case "pending":
      return "TERUGBETALING IN BEHANDELING";
    case "succeeded":
      return "TERUGBETALING GESLAAGD · AFRONDING IN BEHANDELING";
    case "requires_action":
    case "review_required":
    case "failed":
    case "canceled":
      return "TERUGBETALING VEREIST CONTROLE";
    default:
      return "ANNULERING GEREGISTREERD";
  }
}

export default function PlayerPackagePurchases({
  refreshing = false,
  onChanged,
}: Props) {
  const [purchases, setPurchases] =
    useState<PackagePurchase[]>([]);

  const [loading, setLoading] = useState(true);
  const [reloadCount, setReloadCount] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const [selectedPurchaseId, setSelectedPurchaseId] =
    useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const submitInProgress = useRef(false);

  const [errorMessage, setErrorMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    const updateClock = () => setNow(Date.now());

    const interval = window.setInterval(updateClock, 10_000);
    window.addEventListener("focus", updateClock);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", updateClock);
    };
  }, []);

  useEffect(() => {
    if (refreshing) return;

    let stopped = false;
    const controller = new AbortController();

    async function loadPurchases(): Promise<void> {
      setLoading(true);
      setLoadError("");

      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (stopped) return;

        if (sessionError || !session?.access_token) {
          setPurchases([]);
          throw new Error(
            "Log opnieuw in om je pakketaankopen te bekijken."
          );
        }

        const response = await fetch("/api/package-purchases", {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
          cache: "no-store",
          signal: controller.signal,
        });

        const result = (await response.json()) as {
          purchases?: PackagePurchase[];
          error?: string;
        };

        if (stopped) return;

        if (!response.ok || !Array.isArray(result.purchases)) {
          throw new Error(
            result.error ||
              "Je pakketaankopen konden niet worden geladen."
          );
        }

        setPurchases(result.purchases);
        setNow(Date.now());
      } catch (error: unknown) {
        if (stopped) return;

        setLoadError(
          error instanceof Error
            ? error.message
            : "Je pakketaankopen konden niet worden geladen."
        );
      } finally {
        if (!stopped) setLoading(false);
      }
    }

    void loadPurchases();

    return () => {
      stopped = true;
      controller.abort();
    };
  }, [refreshing, reloadCount]);

  async function cancelPackage(
    purchase: PackagePurchase
  ): Promise<void> {
    if (submitInProgress.current) return;

    setErrorMessage("");
    setSuccessMessage("");

    if (!canCancelNow(purchase, Date.now())) {
      setNow(Date.now());
      setSelectedPurchaseId(null);
      setErrorMessage(
        "Dit pakket kan niet meer via deze actie kosteloos worden geannuleerd. Controleer de actuele status."
      );
      return;
    }

    submitInProgress.current = true;
    setSubmitting(true);

    try {
      /*
       * Geen losse Stripe-aanroep vanuit de browser.
       * De database slaat annulering en refundopdracht samen op.
       */
      const { data, error } = await supabase.rpc(
        "request_player_package_cancellation",
        {
          p_purchase_id: purchase.purchaseId,
        }
      );

      if (error) {
        console.error("Pakket annuleren mislukt:", {
          code: error.code,
          message: error.message,
        });

        setErrorMessage(
          error.code === "P0001" || error.code === "42501"
            ? error.message
            : "De annulering kon niet worden bevestigd. Controleer de status voordat je opnieuw probeert."
        );
        return;
      }

      const result = data as CancellationResponse | null;

      if (
        !result ||
        result.purchase_id !== purchase.purchaseId ||
        !result.refund_request_id
      ) {
        setErrorMessage(
          "Het resultaat kon niet worden bevestigd. Controleer de pakketstatus."
        );
        return;
      }

      setSelectedPurchaseId(null);
      setSuccessMessage(result.message);

      // Verberg de actie direct, vóór het opnieuw ophalen.
      setPurchases((current) =>
        current.map((item) =>
          item.purchaseId === purchase.purchaseId
            ? {
                ...item,
                canCancel: false,
                cancellationMessage: result.message,
                cancellation: {
                  refundStatus: result.refund_status,
                  amountCents: result.refund_amount_cents,
                  currency: result.currency,
                  applied: false,
                },
              }
            : item
        )
      );

      try {
        await onChanged();
      } catch {
        setErrorMessage(
          "De annulering is geregistreerd, maar het boekingenoverzicht kon niet worden vernieuwd. Vernieuw de pagina."
        );
      }
    } catch {
      setErrorMessage(
        "De verbinding is onderbroken. De annulering kan al zijn geregistreerd. Controleer eerst de status; vraag niet afzonderlijk een Stripe-refund aan."
      );
    } finally {
      submitInProgress.current = false;
      setSubmitting(false);

      // Ook na een onzekere uitkomst opnieuw de echte status ophalen.
      setReloadCount((value) => value + 1);
    }
  }

  const busy = loading || refreshing || submitting;

  if (
    !loading &&
    !refreshing &&
    !loadError &&
    purchases.length === 0
  ) {
    return null;
  }

  return (
    <section className="mt-10" aria-labelledby="package-purchases-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="package-purchases-title"
          className="font-display text-lg text-[#FF4B3E]"
        >
          JE GEKOCHTE LESPAKKETTEN
        </h2>

        <button
          type="button"
          disabled={busy}
          onClick={() => setReloadCount((value) => value + 1)}
          className="border border-white/30 px-3 py-2 font-display text-xs text-white transition hover:border-[#D6FF3F] hover:text-[#D6FF3F] disabled:opacity-60"
        >
          {loading || refreshing ? "LADEN..." : "↻ CONTROLEER STATUS"}
        </button>
      </div>

      <p className="mt-2 text-sm leading-relaxed text-[#B9BEC2]">
        Je beheert de annulering van een pakket hier. De afzonderlijke
        lessen staan verderop in je boekingenoverzicht.
      </p>

      {(loadError || errorMessage) && (
        <div
          role="alert"
          className="mt-4 border-2 border-[#FF4B3E] px-4 py-3 text-sm text-white"
        >
          {loadError || errorMessage}
        </div>
      )}

      {successMessage && (
        <div
          role="status"
          className="mt-4 border-2 border-[#D6FF3F] bg-[#D6FF3F] px-4 py-3 text-sm font-semibold text-[#14171A]"
        >
          {successMessage}
        </div>
      )}

      {loading && purchases.length === 0 && (
        <p role="status" className="mt-4 text-sm text-[#B9BEC2]">
          Pakketaankopen laden...
        </p>
      )}

      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        {purchases.map((purchase) => {
          const canCancel = canCancelNow(purchase, now);
          const confirming =
            selectedPurchaseId === purchase.purchaseId;

          const deadline = Date.parse(
            purchase.freeCancellationDeadline ?? ""
          );

          const deadlinePassed =
            Number.isFinite(deadline) && now > deadline;

          const explanation =
            purchase.canCancel &&
            !purchase.cancellation &&
            deadlinePassed
              ? "De kosteloze annuleringsdeadline is verstreken. Er is geen automatische spelersrefund meer mogelijk."
              : purchase.cancellationMessage;

          return (
            <article
              key={purchase.purchaseId}
              className="border-2 border-white bg-white p-3 shadow-[6px_6px_0_0_#FF4B3E]"
            >
              <div className="h-full bg-[#14171A] p-5 text-white">
                <span className="inline-block bg-white px-3 py-1.5 font-display text-xs text-[#14171A]">
                  {purchase.cancellation
                    ? getRefundLabel(purchase.cancellation)
                    : "PAKKETAANKOOP"}
                </span>

                <h3 className="mt-4 break-words font-display text-3xl">
                  {purchase.packageTitle}
                </h3>

                <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-y border-white/20 py-4">
                  <p className="text-sm text-[#B9BEC2]">
                    {purchase.lessonCount} lessen ·{" "}
                    {purchase.participantCount} deelnemer
                    {purchase.participantCount === 1 ? "" : "s"}
                  </p>

                  <p className="font-display text-3xl text-[#D6FF3F]">
                    {formatMoney(
                      purchase.totalPriceCents,
                      purchase.currency
                    )}
                  </p>
                </div>

                <p className="mt-4 text-sm leading-relaxed text-[#D7D9DA]">
                  {explanation}
                </p>

                {purchase.freeCancellationDeadline && (
                  <p className="mt-3 text-xs leading-relaxed text-[#B9BEC2]">
                    Kosteloos annuleren tot en met{" "}
                    <strong>
                      {formatDateTime(purchase.freeCancellationDeadline)}
                    </strong>{" "}
                    (Nederlandse tijd).
                  </p>
                )}

                {purchase.cancellation && (
                  <p className="mt-3 text-sm text-[#B9BEC2]">
                    Bedrag van de refundopdracht:{" "}
                    {formatMoney(
                      purchase.cancellation.amountCents,
                      purchase.cancellation.currency
                    )}
                    .
                  </p>
                )}

                {canCancel && !confirming && (
                  <button
                    type="button"
                    disabled={busy || Boolean(loadError)}
                    onClick={() => {
                      setErrorMessage("");
                      setSuccessMessage("");
                      setSelectedPurchaseId(purchase.purchaseId);
                    }}
                    className="mt-6 w-full border-2 border-[#FF4B3E] px-4 py-3 font-display text-base text-[#FF4B3E] transition hover:bg-[#FF4B3E] hover:text-white disabled:opacity-60"
                  >
                    VOLLEDIG PAKKET ANNULEREN
                  </button>
                )}

                {confirming && (
                  <div className="mt-6 border-2 border-[#FF4B3E] p-4">
                    <h4 className="font-display text-xl text-[#FF4B3E]">
                      ALLE LESSEN ANNULEREN?
                    </h4>

                    <p className="mt-3 text-sm leading-relaxed">
                      Hiermee annuleer je alle {purchase.lessonCount}{" "}
                      lessen van dit pakket. Er wordt één terugbetaling
                      van{" "}
                      <strong>
                        {formatMoney(
                          purchase.totalPriceCents,
                          purchase.currency
                        )}
                      </strong>{" "}
                      klaargezet.
                    </p>

                    <p className="mt-2 text-xs leading-relaxed text-[#B9BEC2]">
                      Na bevestigen kun je deze annulering niet zelf
                      ongedaan maken. Terugbetaling is niet onmiddellijk
                      zichtbaar op je bankrekening.
                    </p>

                    {!canCancel && (
                      <p role="alert" className="mt-3 text-sm text-[#FF4B3E]">
                        De kosteloze annulering is niet meer beschikbaar.
                        Controleer de actuele status.
                      </p>
                    )}

                    <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => setSelectedPurchaseId(null)}
                        className="border border-white/40 px-4 py-3 font-display text-sm disabled:opacity-60"
                      >
                        TERUG
                      </button>

                      <button
                        type="button"
                        disabled={
                          busy || !canCancel || Boolean(loadError)
                        }
                        onClick={() => void cancelPackage(purchase)}
                        className="flex-1 bg-[#FF4B3E] px-4 py-3 font-display text-sm text-white transition hover:bg-white hover:text-[#14171A] disabled:opacity-60"
                      >
                        {submitting
                          ? "ANNULERING OPSLAAN..."
                          : "JA, ANNULEER HET HELE PAKKET"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}