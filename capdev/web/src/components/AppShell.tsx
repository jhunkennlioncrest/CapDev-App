import { useEffect, useRef, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import type { Session } from "@/lib/types";
import { EnvironmentBadge } from "@/components/EnvironmentBadge";

export type Workspace = "dashboard" | "rawqa" | "calibration" | "library" | "admin";

interface NavItem {
  key: Workspace;
  label: string;
  /** Permission that reveals it. Undefined means everyone. */
  permission?: string;
}

const NAV: NavItem[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "rawqa", label: "Raw QA", permission: "raw_qa.submit" },
  { key: "calibration", label: "Calibration", permission: "calibration.perform" },
  { key: "library", label: "Library" },
  { key: "admin", label: "Administration", permission: "rubric.manage" },
];

export function visibleWorkspaces(permissions: string[]): NavItem[] {
  return NAV.filter((n) => !n.permission || permissions.includes(n.permission));
}

/**
 * The application shell.
 *
 * Five workspaces, filtered by role. A reviewer sees three; a trainer sees
 * four. Nobody navigates lifecycle stages — the platform advances calls behind
 * the scenes and each role opens the workspace where their work lives.
 */
export function AppShell({
  session,
  active,
  onNavigate,
  children,
}: {
  session: Session;
  active: Workspace;
  onNavigate: (w: Workspace) => void;
  children: ReactNode;
}): JSX.Element {
  const items = visibleWorkspaces(session.permissions);

  const headerRef = useRef<HTMLElement>(null);


  /**

   * Publishes the header's height as --app-header-h.

   *

   * Anything that needs to sit below the navigation reads this rather than

   * guessing a pixel value — the header grows when the nav tabs wrap on a

   * narrow screen, and a hardcoded offset would be wrong exactly then.

   */

  useEffect(() => {

    const el = headerRef.current;

    if (!el) return;

    const publish = (): void => {

      document.documentElement.style.setProperty(

        "--app-header-h",

        `${el.offsetHeight}px`,

      );

    };

    publish();

    const ro = new ResizeObserver(publish);

    ro.observe(el);

    return () => ro.disconnect();

  }, []);


  return (
    <div className="min-h-screen">
      <header
        ref={headerRef}
        className="border-b border-rule bg-ground sticky top-0 z-30"
      >
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex justify-between items-center pt-4 pb-2 gap-4">
            <span className="flex items-center gap-2.5">
              <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-ink-45">
                Capability &amp; Development
              </span>
              <EnvironmentBadge />
            </span>
            <div className="flex items-center gap-3">
              <span className="text-[12px] text-ink-45">{session.person.display_name}</span>
              <button
                onClick={() => void supabase.auth.signOut()}
                className="border border-rule rounded px-3 py-1.5 text-[12.5px] hover:bg-ground-2"
              >
                Sign out
              </button>
            </div>
          </div>

          <nav className="flex gap-1 -mb-px overflow-x-auto">
            {items.map((item) => (
              <button
                key={item.key}
                onClick={() => onNavigate(item.key)}
                className={`px-3.5 py-2.5 text-[13.5px] border-b-2 whitespace-nowrap transition-colors ${
                  active === item.key
                    ? "border-ink text-ink font-medium"
                    : "border-transparent text-ink-45 hover:text-ink"
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main>{children}</main>
    </div>
  );
}

/** Sub-navigation within a workspace. */
export function SubNav<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: T; label: string; count?: number }[];
  active: T;
  onChange: (key: T) => void;
}): JSX.Element {
  return (
    <div className="flex gap-1.5 flex-wrap mb-5">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`border rounded-full px-3.5 py-1.5 text-[13px] ${
            active === t.key
              ? "bg-ink text-ground border-ink"
              : "border-rule hover:bg-ground-2"
          }`}
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && (
            <span className={active === t.key ? "opacity-70 ml-1.5" : "text-ink-45 ml-1.5"}>
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
