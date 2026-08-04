import { useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, type Location } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

export interface NavItem {
  label: string;
  /** Optional for grouped items that only expand to reveal children. */
  to?: string;
  icon: ReactNode;
  badge?: number;
  /** When present, the item renders as an expandable group instead of a link. */
  children?: NavItem[];
  /**
   * Override the default "pathname starts with `to`" active check. For a
   * route shared between two sidebar sections via a query param (e.g. the
   * teacher-creation route doubling as PC creation via ?pc=1), the plain
   * pathname match can't tell them apart.
   */
  isActive?: (location: Pick<Location, "pathname" | "search">) => boolean;
}

interface DashboardShellProps {
  navItems: NavItem[];
  children: ReactNode;
  roleLabel: string;
  /**
   * The logged-in user's own profile page. It used to be a "My Profile" nav
   * tab in every role's sidebar; the footer's name/email block is the link to
   * it now, so each layout has to say where its role's profile lives.
   */
  profileTo: string;
}

function IconMenu() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function IconX() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

/** The footer's profile mark — smaller than the nav icons, since it sits inside a chip. */
function IconUserSmall() {
  return (
    <svg className="w-4 h-4 block" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  );
}

function IconChevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-4 h-4 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

const leafClasses = (isActive: boolean) =>
  `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    isActive
      ? "bg-lime-300 text-navy-700"
      : "text-navy-100 hover:bg-white/10 hover:text-white"
  }`;

function NavLeaf({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  const location = useLocation();

  if (item.isActive) {
    const active = item.isActive(location);
    return (
      <Link to={item.to!} onClick={onNavigate} className={leafClasses(active)}>
        {item.icon}
        <span className="flex-1">{item.label}</span>
        {item.badge != null && item.badge > 0 && (
          <span className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold px-1 leading-none">
            {item.badge > 99 ? "99+" : item.badge}
          </span>
        )}
      </Link>
    );
  }

  return (
    <NavLink
      to={item.to!}
      onClick={onNavigate}
      className={({ isActive }) => leafClasses(isActive)}
    >
      {item.icon}
      <span className="flex-1">{item.label}</span>
      {item.badge != null && item.badge > 0 && (
        <span className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold px-1 leading-none">
          {item.badge > 99 ? "99+" : item.badge}
        </span>
      )}
    </NavLink>
  );
}

function NavGroup({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  const location = useLocation();
  const childActive = (item.children ?? []).some((child) =>
    child.to && (child.isActive ? child.isActive(location) : location.pathname.startsWith(child.to))
  );
  // Auto-expand when landing on one of the group's routes.
  const [open, setOpen] = useState(childActive);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          childActive ? "text-white" : "text-navy-100 hover:bg-white/10 hover:text-white"
        }`}
      >
        {item.icon}
        <span className="flex-1 text-left">{item.label}</span>
        <IconChevron open={open} />
      </button>
      {open && (
        <div className="mt-1 ml-3 flex flex-col gap-1 border-l border-white/10 pl-3">
          {(item.children ?? []).map((child) => (
            <NavLeaf key={child.to} item={child} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  );
}

export function DashboardShell({ navItems, children, roleLabel, profileTo }: DashboardShellProps) {
  const { profile, signOut } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const sidebarContent = (
    <>
      <div className="px-4 py-4 border-b border-white/10 flex items-center justify-between">
        <div>
          <img src="/ascend-now.png" alt="AscendNow" className="h-8 w-auto" />
          <p className="text-xs text-navy-200 mt-1 uppercase tracking-wide">{roleLabel}</p>
        </div>
        {/* Close button — mobile only */}
        <button
          className="md:hidden text-white/70 hover:text-white"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close sidebar"
        >
          <IconX />
        </button>
      </div>

      <nav className="flex-1 px-3 py-4 flex flex-col gap-1">
        {navItems.map((item) =>
          item.children ? (
            <NavGroup key={item.label} item={item} onNavigate={() => setSidebarOpen(false)} />
          ) : (
            <NavLeaf key={item.to} item={item} onNavigate={() => setSidebarOpen(false)} />
          )
        )}
      </nav>

      <div className="px-4 py-4 border-t border-white/10">
        <Link
          to={profileTo}
          onClick={() => setSidebarOpen(false)}
          className="flex items-center gap-2.5 -mx-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/10"
        >
          <span className="shrink-0 rounded-full bg-white/10 p-1.5">
            <IconUserSmall />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold truncate">
              {profile?.full_name ?? profile?.username}
            </span>
            <span className="block text-xs text-navy-200 truncate">{profile?.email}</span>
          </span>
        </Link>
        <button
          onClick={signOut}
          className="mt-3 text-sm font-medium text-lime-300 hover:text-lime-400"
        >
          Sign out
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex bg-navy-50/30">
      {/* Sidebar — desktop: always visible, mobile: slide-in overlay */}
      {/* Mobile overlay backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar panel */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-56 bg-navy-600 text-white flex flex-col transform transition-transform duration-200 ease-in-out
          md:sticky md:top-0 md:h-screen md:translate-x-0 md:shrink-0
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        {sidebarContent}
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto min-w-0">
        {/* Mobile top bar with hamburger */}
        <div className="sticky top-0 z-10 flex items-center gap-3 bg-white/90 backdrop-blur px-4 py-3 border-b border-navy-100 md:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-navy-600 hover:text-navy-800"
            aria-label="Open sidebar"
          >
            <IconMenu />
          </button>
          <div className="bg-white rounded-2xl overflow-hidden px-2 py-0.5 inline-flex items-center">
            <img src="/logo.png" alt="AscendNow" className="h-7 w-auto" />
          </div>
        </div>

        <div className="px-4 py-6 md:px-6 md:py-8">{children}</div>
      </main>
    </div>
  );
}
