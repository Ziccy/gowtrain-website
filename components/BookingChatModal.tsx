"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { supabase } from "@/lib/supabase-browser";

type ChatMessage = {
  id: string;
  booking_id: string;
  sender_id: string;
  sender_role: "player" | "trainer";
  sender_name: string;
  message: string;
  created_at: string;
};

type BookingChatModalProps = {
  bookingId: string;
  recipientName: string;
  trainingLabel?: string;
  venueLabel?: string;
  currentUserRole: "player" | "trainer";
  currentUserId: string;
  currentUserName: string;
  onClose: () => void;
  onMessagesRead?: () => void;
};

const MESSAGE_PAGE_SIZE = 200;
const POLL_INTERVAL_MS = 4000;

function formatTime(value: string): string {
  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) return "--:--";

  return new Intl.DateTimeFormat("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Amsterdam",
  }).format(new Date(timestamp));
}

function formatDate(value: string): string {
  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) return "";

  return new Intl.DateTimeFormat("nl-NL", {
    day: "numeric",
    month: "short",
    timeZone: "Europe/Amsterdam",
  }).format(new Date(timestamp));
}

/*
 * Een andere boeking of gebruiker krijgt een nieuwe chatsessie.
 * Daardoor worden invoer, aanvragen en leesregistraties niet
 * hergebruikt voor een ander gesprek.
 */
export default function BookingChatModal(
  props: BookingChatModalProps
) {
  return (
    <BookingChatSession
      key={`${props.bookingId}:${props.currentUserId}`}
      {...props}
    />
  );
}

function BookingChatSession({
  bookingId,
  recipientName,
  trainingLabel,
  venueLabel,
  currentUserRole,
  currentUserId,
  currentUserName,
  onClose,
  onMessagesRead,
}: BookingChatModalProps) {
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const mountedRef = useRef(false);
  const sendBusyRef = useRef(false);
  const readBusyRef = useRef(false);

  const pendingReadIdsRef = useRef(new Set<string>());
  const acknowledgedReadIdsRef = useRef(new Set<string>());
  const notifiedMessageIdsRef = useRef(new Set<string>());

  const firstScrollDoneRef = useRef(false);
  const stickToBottomRef = useRef(true);

  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const onMessagesReadRef = useRef(onMessagesRead);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");

  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [canSend, setCanSend] = useState<boolean | null>(null);
  const [uncertainSend, setUncertainSend] = useState(false);

  const [loadError, setLoadError] = useState("");
  const [readError, setReadError] = useState("");
  const [sendError, setSendError] = useState("");

  useEffect(() => {
    onMessagesReadRef.current = onMessagesRead;
  }, [onMessagesRead]);

  function notifyMessageStateChanged(): void {
    onMessagesReadRef.current?.();
  }

  /*
   * Alleen GET-aanvragen worden automatisch herhaald.
   * Binnen deze chatsessie loopt maximaal één laadactie tegelijk.
   */
  useEffect(() => {
    let active = true;
    let loadBusy = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    mountedRef.current = true;

    async function loadConversation(): Promise<void> {
      if (!active || loadBusy) return;
      if (document.visibilityState !== "visible") return;

      loadBusy = true;

      try {
        const loadedMessages: ChatMessage[] = [];
        const seenIds = new Set<string>();

        /*
         * Expliciete paginering voorkomt dat een lange chat
         * stilzwijgend bij de standaard API-rijlimiet stopt.
         */
        for (let offset = 0; ; offset += MESSAGE_PAGE_SIZE) {
          const { data, error } = await supabase
            .from("booking_messages")
            .select(
              "id, booking_id, sender_id, sender_role, sender_name, message, created_at"
            )
            .eq("booking_id", bookingId)
            .order("created_at", { ascending: true })
            .order("id", { ascending: true })
            .range(offset, offset + MESSAGE_PAGE_SIZE - 1);

          if (!active) return;

          if (error) {
            throw new Error("Berichten konden niet worden geladen.");
          }

          if (!Array.isArray(data)) {
            throw new Error("De berichten konden niet worden gecontroleerd.");
          }

          const page = data as ChatMessage[];

          for (const message of page) {
            if (!seenIds.has(message.id)) {
              seenIds.add(message.id);
              loadedMessages.push(message);
            }
          }

          if (page.length < MESSAGE_PAGE_SIZE) break;
        }

        const { data: allowed, error: permissionError } =
          await supabase.rpc("can_send_booking_message", {
            p_booking_id: bookingId,
          });

        if (!active) return;

        setMessages(loadedMessages);

        if (permissionError || typeof allowed !== "boolean") {
          setCanSend(null);
          setLoadError(
            "Berichten zijn geladen, maar we konden niet controleren of je mag versturen."
          );
        } else {
          setCanSend(allowed);
          setLoadError("");
        }
      } catch (error: unknown) {
        if (!active) return;

        // Bij onzekere actuele status versturen tijdelijk blokkeren.
        setCanSend(null);
        setLoadError(
          error instanceof Error
            ? error.message
            : "Berichten konden niet worden geladen."
        );
      } finally {
        loadBusy = false;

        if (active) {
          setLoading(false);
        }
      }
    }

    async function poll(): Promise<void> {
      await loadConversation();

      if (active) {
        timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
      }
    }

    function handleReturn(): void {
      if (document.visibilityState === "visible") {
        void loadConversation();
      }
    }

    refreshRef.current = loadConversation;

    window.addEventListener("focus", handleReturn);
    document.addEventListener("visibilitychange", handleReturn);

    void poll();

    return () => {
      active = false;
      mountedRef.current = false;

      if (timer !== undefined) clearTimeout(timer);

      window.removeEventListener("focus", handleReturn);
      document.removeEventListener("visibilitychange", handleReturn);

      refreshRef.current = async () => {};
    };
  }, [bookingId]);

  /*
   * Scroll bij eerste opening naar de nieuwste berichten.
   * Daarna alleen automatisch volgen als de gebruiker al
   * onderaan stond. Teruglezen wordt niet iedere vier seconden
   * onderbroken.
   */
  useEffect(() => {
    if (loading || messages.length === 0) return;

    if (!firstScrollDoneRef.current || stickToBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({
        behavior: "auto",
        block: "end",
      });

      firstScrollDoneRef.current = true;
    }
  }, [messages, loading]);

  /*
   * Alleen ontvangen berichten die zichtbaar zijn geweest
   * binnen het actieve chatvenster komen in de leesregistratie.
   *
   * Een bericht geldt hier als zichtbaar zodra minimaal een
   * gedeelte ervan in het scrollvenster staat.
   */
  useEffect(() => {
    const container = messagesContainerRef.current;

    if (loading || !container || messages.length === 0) return;

    let active = true;
    let observer: IntersectionObserver | null = null;

    const receivedIds = new Set(
      messages
        .filter((message) => message.sender_id !== currentUserId)
        .map((message) => message.id)
    );

    function isForeground(): boolean {
      return (
        active &&
        mountedRef.current &&
        document.visibilityState === "visible" &&
        document.hasFocus()
      );
    }

    async function flushReadQueue(): Promise<void> {
      if (!isForeground() || readBusyRef.current) return;

      readBusyRef.current = true;

      try {
        while (isForeground()) {
          const batch = Array.from(pendingReadIdsRef.current)
            .filter(
              (id) =>
                receivedIds.has(id) &&
                !acknowledgedReadIdsRef.current.has(id)
            )
            .slice(0, 500);

          if (batch.length === 0) break;

          const { data, error } = await supabase.rpc(
            "mark_booking_messages_read",
            {
              p_booking_id: bookingId,
              p_message_ids: batch,
            }
          );

          if (!mountedRef.current) return;

          if (
            error ||
            typeof data !== "number" ||
            !Number.isInteger(data) ||
            data < 0 ||
            data > batch.length
          ) {
            setReadError(
              "De leesstatus kon niet worden bevestigd. De berichten blijven beschikbaar; we proberen de leesregistratie opnieuw wanneer je het gesprek bekijkt."
            );
            break;
          }

          let shouldNotify = false;

          for (const id of batch) {
            pendingReadIdsRef.current.delete(id);
            acknowledgedReadIdsRef.current.add(id);

            /*
             * Ook bij resultaat 0 kan de status al centraal
             * gelezen zijn, bijvoorbeeld op een ander apparaat.
             */
            if (!notifiedMessageIdsRef.current.has(id)) {
              notifiedMessageIdsRef.current.add(id);
              shouldNotify = true;
            }
          }

          setReadError("");

          if (shouldNotify) {
            notifyMessageStateChanged();
          }
        }
      } catch {
        if (mountedRef.current) {
          setReadError(
            "De leesstatus kon niet worden bevestigd. Deze wordt opnieuw geprobeerd wanneer je het gesprek bekijkt."
          );
        }
      } finally {
        readBusyRef.current = false;
      }
    }

    function startObserving(): void {
      observer?.disconnect();

      if (!isForeground()) return;

      if (typeof IntersectionObserver === "undefined") {
        setReadError(
          "Deze browser ondersteunt de zichtbaarheidcontrole niet. Berichten worden daarom niet automatisch als gelezen gemarkeerd."
        );
        return;
      }

      observer = new IntersectionObserver(
        (entries) => {
          if (!isForeground()) return;

          for (const entry of entries) {
            if (
              !entry.isIntersecting ||
              entry.intersectionRect.width <= 0 ||
              entry.intersectionRect.height <= 0
            ) {
              continue;
            }

            const id = (entry.target as HTMLElement).dataset.messageId;

            if (
              id &&
              receivedIds.has(id) &&
              !acknowledgedReadIdsRef.current.has(id)
            ) {
              pendingReadIdsRef.current.add(id);
            }
          }

          void flushReadQueue();
        },
        {
          root: container,
          threshold: 0,
        }
      );

      container
        ?.querySelectorAll<HTMLElement>("[data-message-id]")
        .forEach((element) => {
          const id = element.dataset.messageId;

          if (
            id &&
            receivedIds.has(id) &&
            !acknowledgedReadIdsRef.current.has(id)
          ) {
            observer?.observe(element);
          }
        });

      void flushReadQueue();
    }

    startObserving();

    window.addEventListener("focus", startObserving);
    document.addEventListener("visibilitychange", startObserving);

    return () => {
      active = false;
      observer?.disconnect();

      window.removeEventListener("focus", startObserving);
      document.removeEventListener("visibilitychange", startObserving);
    };
  }, [messages, loading, bookingId, currentUserId]);

  function handleMessagesScroll(): void {
    const container = messagesContainerRef.current;
    if (!container) return;

    const distanceFromBottom =
      container.scrollHeight -
      container.scrollTop -
      container.clientHeight;

    stickToBottomRef.current = distanceFromBottom < 80;
  }

  async function handleSendMessage(
    event: FormEvent<HTMLFormElement>
  ): Promise<void> {
    event.preventDefault();

    const text = newMessage.trim();

    if (
      !text ||
      sendBusyRef.current ||
      uncertainSend ||
      canSend !== true
    ) {
      return;
    }

    sendBusyRef.current = true;
    setSending(true);
    setSendError("");

    try {
      /*
       * Opnieuw controleren vlak voor versturen.
       * De INSERT-policy blijft de definitieve controle:
       * tussen deze RPC en de INSERT kan de les eindigen.
       */
      const { data: allowed, error: permissionError } =
        await supabase.rpc("can_send_booking_message", {
          p_booking_id: bookingId,
        });

      if (!mountedRef.current) return;

      if (permissionError || typeof allowed !== "boolean") {
        setCanSend(null);
        setSendError(
          "We konden niet controleren of je mag versturen. Er is geen bericht verstuurd."
        );
        return;
      }

      setCanSend(allowed);

      if (!allowed) {
        setSendError(
          "Versturen is niet meer toegestaan. Je kunt bestaande berichten nog teruglezen."
        );
        return;
      }

      const { error } = await supabase
        .from("booking_messages")
        .insert({
          booking_id: bookingId,
          sender_id: currentUserId,
          sender_role: currentUserRole,
          sender_name: currentUserName,
          message: text,
        });

      if (!mountedRef.current) return;

      if (error) {
        if (error.code === "42501") {
          setCanSend(false);
          setSendError(
            "Versturen is niet toegestaan. De boekingsstatus of lestijd kan inmiddels veranderd zijn."
          );
        } else {
          /*
           * Bij een onduidelijk resultaat niet automatisch
           * opnieuw verzenden: de INSERT kan al verwerkt zijn.
           */
          setUncertainSend(true);
          setSendError(
            "We konden niet bevestigen of het bericht is verstuurd. Controleer het gesprek en verstuur dezelfde tekst niet zomaar opnieuw. Sluit en heropen het gesprek nadat je dit hebt gecontroleerd."
          );
        }

        await refreshRef.current();
        return;
      }

      setNewMessage("");
      stickToBottomRef.current = true;

      notifyMessageStateChanged();
      await refreshRef.current();
      inputRef.current?.focus();
    } catch {
      if (mountedRef.current) {
        setUncertainSend(true);
        setSendError(
          "De verbinding is onderbroken. Het bericht kan al verstuurd zijn. Controleer het gesprek voordat je opnieuw verstuurt."
        );
      }
    } finally {
      sendBusyRef.current = false;

      if (mountedRef.current) {
        setSending(false);
      }
    }
  }

  const inputDisabled =
    loading ||
    sending ||
    canSend !== true ||
    uncertainSend;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-chat-title"
        className="flex max-h-[90dvh] w-full max-w-lg flex-col border-2 border-[#D6FF3F] bg-[#14171A] text-white shadow-[10px_10px_0_0_#FF4B3E]"
      >
        {/* HEADER */}
        <div className="shrink-0 border-b-2 border-white/20 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <span className="bg-[#FF4B3E] px-2.5 py-0.5 font-display text-[10px] uppercase text-white">
                BERICHTEN
              </span>

              <h3
                id="booking-chat-title"
                className="mt-1 break-words font-display text-2xl text-white"
              >
                CHAT MET {recipientName.toUpperCase()}
              </h3>

              {(trainingLabel || venueLabel) && (
                <div className="mt-2 border-l-2 border-[#D6FF3F] py-0.5 pl-2.5">
                  {trainingLabel && (
                    <p className="font-display text-xs text-[#D6FF3F]">
                      {trainingLabel}
                    </p>
                  )}

                  {venueLabel && (
                    <p className="mt-0.5 text-[11px] font-semibold text-[#B9BEC2]">
                      📍 {venueLabel}
                    </p>
                  )}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              disabled={sending}
              aria-label="Gesprek sluiten"
              className="flex h-11 w-11 shrink-0 items-center justify-center border-2 border-white font-display text-lg text-white transition hover:bg-[#FF4B3E] disabled:opacity-50"
            >
              ✕
            </button>
          </div>
        </div>

        {/* BERICHTEN */}
        <div
          ref={messagesContainerRef}
          onScroll={handleMessagesScroll}
          aria-label="Berichten in dit gesprek"
          tabIndex={0}
          className="h-80 min-h-0 space-y-3 overflow-y-auto bg-[#14171A] p-4 sm:p-5"
        >
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <p className="font-display text-sm text-[#D6FF3F] motion-safe:animate-pulse">
                BERICHTEN LADEN...
              </p>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full items-center justify-center border border-dashed border-white/20 p-4 text-center">
              <p className="text-xs text-[#B9BEC2]">
                {loadError
                  ? "Het gesprek kon nog niet volledig worden geladen."
                  : "Nog geen berichten gewisseld."}
              </p>
            </div>
          ) : (
            messages.map((msg) => {
              const isMe = msg.sender_id === currentUserId;

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${
                    isMe ? "items-end" : "items-start"
                  }`}
                >
                  <span className="mb-1 text-[10px] text-[#8A8F94]">
                    {msg.sender_name} · {formatDate(msg.created_at)} ·{" "}
                    {formatTime(msg.created_at)}
                  </span>

                  <div
                    data-message-id={msg.id}
                    className={`max-w-[85%] whitespace-pre-wrap break-words border-2 p-3 text-xs leading-relaxed ${
                      isMe
                        ? "border-[#D6FF3F] bg-[#D6FF3F] font-semibold text-[#14171A]"
                        : "border-white bg-white text-[#14171A]"
                    }`}
                  >
                    {msg.message}
                  </div>

                  {isMe && (
                    <span className="mt-0.5 font-display text-[9px] text-[#B9BEC2]">
                      ✓ VERSTUURD
                    </span>
                  )}
                </div>
              );
            })
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* FOUTMELDINGEN */}
        {(loadError || readError || sendError) && (
          <div
            role="alert"
            className="max-h-36 shrink-0 space-y-2 overflow-y-auto bg-[#FF4B3E]/10 px-4 py-3 text-xs font-semibold text-[#FF4B3E] sm:px-5"
          >
            {loadError && <p>{loadError}</p>}
            {readError && <p>{readError}</p>}
            {sendError && <p>{sendError}</p>}

            <button
              type="button"
              onClick={() => void refreshRef.current()}
              disabled={sending}
              className="min-h-11 border border-[#FF4B3E] px-3 py-2 font-display text-xs disabled:opacity-50"
            >
              BERICHTEN OPNIEUW OPHALEN
            </button>
          </div>
        )}

        {/* ALLEEN LEZEN / INVOER */}
        {!loading && canSend === false ? (
          <div className="shrink-0 border-t-2 border-white/20 p-4">
            <p className="font-display text-sm text-[#D6FF3F]">
              ALLEEN TERUGLEZEN
            </p>
            <p className="mt-1 text-xs leading-relaxed text-[#B9BEC2]">
              Versturen kan alleen bij een betaalde, bevestigde boeking
              tot het einde van de les.
            </p>
          </div>
        ) : (
          <form
            onSubmit={handleSendMessage}
            className="shrink-0 border-t-2 border-white/20 bg-[#14171A] p-4"
          >
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={newMessage}
                disabled={inputDisabled}
                onChange={(event) => setNewMessage(event.target.value)}
                aria-label={`Bericht aan ${recipientName}`}
                placeholder={`Schrijf aan ${recipientName}...`}
                className="min-h-11 min-w-0 flex-1 border-2 border-white/25 bg-transparent p-3 text-xs text-white outline-none focus:border-[#D6FF3F] disabled:opacity-50"
              />

              <button
                type="submit"
                disabled={inputDisabled || !newMessage.trim()}
                className="min-h-11 shrink-0 bg-[#FF4B3E] px-4 py-3 font-display text-sm text-white transition hover:bg-[#D6FF3F] hover:text-[#14171A] disabled:opacity-50"
              >
                {sending ? "..." : "STUUR →"}
              </button>
            </div>

            {!loading && canSend === null && (
              <p className="mt-2 text-xs text-[#B9BEC2]">
                Versturen is tijdelijk geblokkeerd totdat je toegang
                opnieuw is gecontroleerd.
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}