import NextAuth, { DefaultSession, DefaultUser } from "next-auth";
import { Role } from "@prisma/client";

declare module "next-auth" {
  interface User extends DefaultUser {
    id: string;
    role: Role;
    schoolId?: string | null;
    mobile?: string | null;
    studentId?: string | null;
  }

  interface Session {
    user: {
      id: string;
      role: Role;
      schoolId?: string | null;
      mobile?: string | null;
      studentId?: string | null;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
    schoolId?: string | null;
    mobile?: string | null;
    studentId?: string | null;
  }
}
