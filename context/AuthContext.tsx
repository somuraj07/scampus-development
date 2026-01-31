"use client";

import { createContext, useContext } from "react";
import { SessionProvider, useSession } from "next-auth/react";
import type { Session } from "next-auth";

interface AuthContextType {
  user: Session["user"] | null;
  isAuthenticated: boolean;
  role: string | null;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAuthenticated: false,
  role: null,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}

export function useAuth() {
  const { data: session, status } = useSession();

  return {
    user: session?.user || null,
    isAuthenticated: status === "authenticated",
    role: session?.user?.role ?? null,
  };
}

export default AuthContext;
