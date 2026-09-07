"use client";

import { useEffect, useRef, useState, FormEvent } from "react";
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

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function BookingChatModal({
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
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState<string>("");

  const [loading, setLoading] = useState<boolean>(true);
  const [sending, setSending] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    // Markeer de chat direct als gelezen voor deze gebruiker op dit apparaat
    markAsReadLocally();
    void loadMessages();

    const interval = setInterval(() => {
      void loadMessages(false);
    }, 4000);

    return () => clearInterval(interval);
  }, [bookingId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function markAsReadLocally() {
    try {
      const storageKey = `gowtrain_read_${currentUserRole}_${bookingId}`;
      localStorage.setItem(storageKey, new Date().toISOString());
      if (onMessagesRead) {
        onMessagesRead();
      }
    } catch (e) {
      console.error("LocalStorage error:", e);
    }
  }

  async function loadMessages(showLoading = true): Promise<void> {
    if (showLoading) setLoading(true);

    try {
      const { data, error } = await supabase
        .from("booking_messages")
        .select("*")
        .eq("booking_id", bookingId)
        .order("created_at", { ascending: true });

      if (error) {
        setErrorMessage("Berichten konden niet worden geladen.");
        return;
      }

      setMessages((data ?? []) as ChatMessage[]);
      markAsReadLocally();
    } catch {
      setErrorMessage("Berichten konden niet worden geladen.");
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  async function handleSendMessage(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!newMessage.trim()) return;

    setSending(true);
    setErrorMessage("");

    try {
      const textToSend = newMessage.trim();

      const { error } = await supabase.from("booking_messages").insert({
        booking_id: bookingId,
        sender_id: currentUserId,
        sender_role: currentUserRole,
        sender_name: currentUserName,
        message: textToSend,
      });

      if (error) {
        setErrorMessage("Bericht kon niet worden verstuurd.");
        return;
      }

      setNewMessage("");
      markAsReadLocally();
      await loadMessages(false);
    } catch {
      setErrorMessage("Bericht kon niet worden verstuurd.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg border-2 border-[#D6FF3F] bg-[#14171A] text-white shadow-[10px_10px_0_0_#FF4B3E]">
        
        {/* HEADER */}
        <div className="border-b-2 border-white/20 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="bg-[#FF4B3E] px-2.5 py-0.5 font-display text-[10px] text-white uppercase">
                BERICHTEN
              </span>
              <h3 className="font-display text-2xl text-white mt-1">
                CHAT MET {recipientName.toUpperCase()}
              </h3>

              {trainingLabel && (
                <div className="mt-2 border-l-2 border-[#D6FF3F] pl-2.5 py-0.5">
                  <p className="font-display text-xs text-[#D6FF3F]">{trainingLabel}</p>
                  {venueLabel && (
                    <p className="text-[11px] text-[#B9BEC2] font-semibold mt-0.5">📍 {venueLabel}</p>
                  )}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 shrink-0 items-center justify-center border-2 border-white font-display text-lg text-white hover:bg-[#FF4B3E] transition"
            >
              ✕
            </button>
          </div>
        </div>

        {/* MESSAGES BODY */}
        <div className="h-80 overflow-y-auto p-4 sm:p-5 space-y-3 bg-[#14171A]">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <p className="font-display text-sm text-[#D6FF3F] animate-pulse">BERICHTEN LADEN...</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-center p-4 border border-dashed border-white/20">
              <p className="text-xs text-[#B9BEC2]">
                Nog geen berichten gewisseld. Typ hieronder een bericht om af te stemmen met {recipientName}.
              </p>
            </div>
          ) : (
            messages.map((msg) => {
              const isMe = msg.sender_id === currentUserId || msg.sender_role === currentUserRole;

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}
                >
                  <span className="text-[10px] text-[#8A8F94] mb-1">
                    {msg.sender_name} · {formatTime(msg.created_at)}
                  </span>

                  <div
                    className={`max-w-[85%] border-2 p-3 text-xs leading-relaxed ${
                      isMe
                        ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A] font-semibold"
                        : "border-white bg-white text-[#14171A]"
                    }`}
                  >
                    {msg.message}
                  </div>

                  {isMe && (
                    <span className="text-[9px] mt-0.5 font-display text-[#B9BEC2]">
                      ✓ VERSTUURD
                    </span>
                  )}
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {errorMessage && (
          <p className="px-5 py-2 text-xs text-[#FF4B3E] font-semibold bg-[#FF4B3E]/10">{errorMessage}</p>
        )}

        {/* INPUT FORM */}
        <form onSubmit={handleSendMessage} className="border-t-2 border-white/20 p-4 bg-[#14171A]">
          <div className="flex gap-2">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder={`Schrijf een bericht aan ${recipientName}...`}
              className="flex-1 border-2 border-white/25 bg-transparent p-3 text-xs text-white outline-none focus:border-[#D6FF3F]"
            />

            <button
              type="submit"
              disabled={sending || !newMessage.trim()}
              className="bg-[#FF4B3E] px-5 py-3 font-display text-sm text-white hover:bg-[#D6FF3F] hover:text-[#14171A] transition disabled:opacity-50"
            >
              {sending ? "..." : "STUUR →"}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}