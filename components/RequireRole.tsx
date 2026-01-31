"use client";

import { ReactNode, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

// Allowed roles from your schema
type UserRoles = "SUPERADMIN" | "SCHOOLADMIN" | "TEACHER" | "STUDENT" | "PRINCIPAL" | "HOD";

interface RequireRoleProps {
  children: ReactNode;
  allowedRoles: UserRoles[];
}

export default function RequireRole({ children, allowedRoles }: RequireRoleProps) {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "loading") return; // Wait for session

    const role = session?.user?.role as UserRoles | undefined;

    // If user is not logged in OR role doesn't match
    if (!role || !allowedRoles.includes(role)) {
      router.replace("/unauthorized");
    }
  }, [session, status, router, allowedRoles]);

  if (status === "loading") {
    return <p>Loading...</p>;
  }

  return <>{children}</>;
}
