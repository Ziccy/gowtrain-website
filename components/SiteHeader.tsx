"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-browser";

export default function SiteHeader() {
  const router = useRouter();
  const pathname = usePathname();

  const [loginMenuOpen, setLoginMenuOpen] = useState(false);
  const [userRole, setUserRole] = useState<"player" | "trainer" | "admin" | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Sluit dropdown als er buiten geklikt wordt
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setLoginMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Check Supabase Inlogstatus
  useEffect(() => {
    void checkUserSession();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!session) {
          setUserRole(null);
          setUserName(null);
          setLoadingSession(false);
        } else {
          void checkUserSession();
        }
      }
    );

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  async function checkUserSession() {
    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.user) {
        setUserRole(null);
        setUserName(null);
        setLoadingSession(false);
        return;
      }

      // 1. Check profiel rol (admin, trainer of speler)
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, role")
        .eq("id", session.user.id)
        .maybeSingle();

      if (profile) {
        if (profile.role === "admin") {
          setUserRole("admin");
        } else if (profile.role === "trainer") {
          setUserRole("trainer");
        } else {
          setUserRole("player");
        }

        if (profile.full_name) {
          setUserName(profile.full_name.trim().split(" ")[0]);
        }
      } else {
        // Fallback: Check of gebruiker voorkomt in 'trainers' tabel
        const { data: trainer } = await supabase
          .from("trainers")
          .select("name")
          .eq("user_id", session.user.id)
          .maybeSingle();

        if (trainer) {
          setUserRole("trainer");
          setUserName(trainer.name.trim().split(" ")[0]);
        } else {
          setUserRole("player");
        }
      }
    } catch {
      setUserRole(null);
    } finally {
      setLoadingSession(false);
    }
  }

  async function handleLogout() {
    setLoginMenuOpen(false);
    await supabase.auth.signOut();
    setUserRole(null);
    setUserName(null);
    router.replace("/");
    router.refresh();
  }

  return (
    <header className="relative z-30 bg-[#14171A] border-b border-white/15">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:py-7">
        
        {/* LOGO */}
        <Link
          href="/"
          aria-label="GowTrain home"
          className="group inline-flex items-center gap-2"
        >
          <span className="font-display text-3xl leading-none text-[#D6FF3F] sm:text-4xl">
            GOWTRAIN
          </span>
          <span className="mt-1 h-0 w-0 border-b-[9px] border-l-[8px] border-t-[9px] border-b-transparent border-l-[#D6FF3F] border-t-transparent transition-transform duration-200 group-hover:translate-x-1 sm:border-b-[11px] sm:border-l-[9px] sm:border-t-[11px]" />
        </Link>

        {/* NAVIGATIE */}
        <nav
          aria-label="Hoofdnavigatie"
          className="hidden items-center gap-8 font-display text-lg md:flex lg:gap-10"
        >
          <Link href="/#spelers" className="transition hover:text-[#D6FF3F]">
            SPELERS
          </Link>
          <Link href="/#trainers" className="transition hover:text-[#D6FF3F]">
            TRAINERS
          </Link>
          <Link href="/trainers" className="transition hover:text-[#D6FF3F]">
            AANBOD
          </Link>
          <Link href="/#over-gowtrain" className="transition hover:text-[#D6FF3F]">
            OVER
          </Link>
        </nav>

        {/* RECHTS: DYNAMISCHE INLOGSTATUS + CTA KNOP */}
        <div className="flex items-center gap-3 sm:gap-4">
          
          {/* DESKTOP WEERGAVE */}
          <div className="hidden items-center gap-3 lg:flex">
            {!loadingSession && (
              <>
                {userRole === "admin" && (
                  <>
                    <Link
                      href="/admin"
                      className="font-display text-sm text-[#FF4B3E] transition hover:text-white"
                    >
                      ADMIN HUB
                    </Link>
                    <span className="text-[#8A8F94]">|</span>
                    <button
                      type="button"
                      onClick={() => void handleLogout()}
                      className="font-display text-sm text-[#D7D9DA] transition hover:text-[#FF4B3E]"
                    >
                      UITLOGGEN
                    </button>
                  </>
                )}

                {userRole === "player" && (
                  <>
                    <Link
                      href="/mijn-boekingen"
                      className="font-display text-sm text-[#D6FF3F] transition hover:text-white"
                    >
                      MIJN BOEKINGEN
                    </Link>
                    <span className="text-[#8A8F94]">|</span>
                    <button
                      type="button"
                      onClick={() => void handleLogout()}
                      className="font-display text-sm text-[#D7D9DA] transition hover:text-[#FF4B3E]"
                    >
                      UITLOGGEN
                    </button>
                  </>
                )}

                {userRole === "trainer" && (
                  <>
                    <Link
                      href="/trainer-dashboard"
                      className="font-display text-sm text-[#D6FF3F] transition hover:text-white"
                    >
                      DASHBOARD
                    </Link>
                    <span className="text-[#8A8F94]">|</span>
                    <button
                      type="button"
                      onClick={() => void handleLogout()}
                      className="font-display text-sm text-[#D7D9DA] transition hover:text-[#FF4B3E]"
                    >
                      UITLOGGEN
                    </button>
                  </>
                )}

                {!userRole && (
                  <>
                    <Link
                      href="/speler-login"
                      className="font-display text-sm text-[#D7D9DA] transition hover:text-[#D6FF3F]"
                    >
                      LOGIN SPELER
                    </Link>
                    <span className="text-[#8A8F94]">|</span>
                    <Link
                      href="/trainer-login"
                      className="font-display text-sm text-[#D7D9DA] transition hover:text-[#D6FF3F]"
                    >
                      LOGIN TRAINER
                    </Link>
                  </>
                )}
              </>
            )}
          </div>

          {/* MOBIEL / TABLET DROPDOWN MENU */}
          <div className="relative lg:hidden" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setLoginMenuOpen(!loginMenuOpen)}
              className="border border-white/30 bg-[#14171A] px-3 py-2 font-display text-xs text-white transition hover:border-[#D6FF3F] hover:text-[#D6FF3F]"
            >
              {userRole ? `HÉ, ${userName?.toUpperCase() || "ACCOUNT"} ▾` : "INLOGGEN ▾"}
            </button>

            {loginMenuOpen && (
              <div className="absolute right-0 mt-2 w-48 border-2 border-white bg-[#14171A] p-2 shadow-[6px_6px_0_0_#FF4B3E]">
                {userRole === "admin" && (
                  <>
                    <Link
                      href="/admin"
                      onClick={() => setLoginMenuOpen(false)}
                      className="block px-3 py-2 font-display text-sm text-[#FF4B3E] hover:bg-[#FF4B3E] hover:!text-white"
                    >
                      ADMIN HUB
                    </Link>
                    <button
                      type="button"
                      onClick={() => void handleLogout()}
                      className="w-full text-left px-3 py-2 font-display text-sm text-white hover:bg-white hover:!text-[#14171A]"
                    >
                      UITLOGGEN
                    </button>
                  </>
                )}

                {userRole === "player" && (
                  <>
                    <Link
                      href="/mijn-boekingen"
                      onClick={() => setLoginMenuOpen(false)}
                      className="block px-3 py-2 font-display text-sm text-[#D6FF3F] hover:bg-[#D6FF3F] hover:!text-[#14171A]"
                    >
                      MIJN BOEKINGEN
                    </Link>
                    <button
                      type="button"
                      onClick={() => void handleLogout()}
                      className="w-full text-left px-3 py-2 font-display text-sm text-[#FF4B3E] hover:bg-[#FF4B3E] hover:!text-white"
                    >
                      UITLOGGEN
                    </button>
                  </>
                )}

                {userRole === "trainer" && (
                  <>
                    <Link
                      href="/trainer-dashboard"
                      onClick={() => setLoginMenuOpen(false)}
                      className="block px-3 py-2 font-display text-sm text-[#D6FF3F] hover:bg-[#D6FF3F] hover:!text-[#14171A]"
                    >
                      TRAINER DASHBOARD
                    </Link>
                    <button
                      type="button"
                      onClick={() => void handleLogout()}
                      className="w-full text-left px-3 py-2 font-display text-sm text-[#FF4B3E] hover:bg-[#FF4B3E] hover:!text-white"
                    >
                      UITLOGGEN
                    </button>
                  </>
                )}

                {!userRole && (
                  <>
                    <Link
                      href="/speler-login"
                      onClick={() => setLoginMenuOpen(false)}
                      className="block px-3 py-2 font-display text-sm text-white hover:bg-[#D6FF3F] hover:!text-[#14171A]"
                    >
                      SPELER LOGIN
                    </Link>
                    <Link
                      href="/trainer-login"
                      onClick={() => setLoginMenuOpen(false)}
                      className="block px-3 py-2 font-display text-sm text-white hover:bg-[#FF4B3E] hover:!text-white"
                    >
                      TRAINER LOGIN
                    </Link>
                  </>
                )}
              </div>
            )}
          </div>

          {/* PRIMAIRE CTA KNOP (ALLEEN OP HOMEPAGE) */}
          {pathname === "/" && (
            <Link
              href="/trainers"
              className="bg-[#FF4B3E] px-4 py-2.5 font-display text-sm text-white transition hover:bg-[#D6FF3F] hover:!text-[#14171A] sm:px-5 sm:py-3"
            >
              GOW!
            </Link>
          )}
        </div>

      </div>
    </header>
  );
}