import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import prisma from "@/lib/db";
import bcrypt from "bcryptjs";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),

  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },

      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          console.log("Auth: Missing email or password");
          return null;
        }

        try {
          const user = await prisma.user.findUnique({
            where: { email: credentials.email },
            include: {
              student: true,
              assignedClasses: true,
              school: true,
            },
          });

          if (!user) {
            console.log("Auth: User not found for email:", credentials.email);
            return null;
          }

          if (!user.password) {
            console.log("Auth: User has no password set");
            return null;
          }

          const isValid = await bcrypt.compare(
            credentials.password,
            user.password
          );

          if (!isValid) {
            console.log("Auth: Password mismatch for user:", credentials.email);
            return null;
          }

          console.log("Auth: Successfully authenticated user:", user.email, "Role:", user.role);

          return {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            schoolId: user.schoolId,
            mobile: user.mobile,
            studentId: user.student?.id ?? null,
          };
        } catch (error) {
          console.error("Auth error:", error);
          return null;
        }
      },
    }),
  ],

  session: {
    strategy: "jwt",
  },

  callbacks: {
  async jwt({ token, user }) {
    // First login
    if (user) {
      token.id = user.id;
      token.role = user.role;
      token.schoolId = user.schoolId;
      token.mobile = user.mobile;
      token.studentId = user.studentId;
    }

    // 🔥 IMPORTANT: keep schoolId always in sync
    if (token.id && !token.schoolId) {
      const dbUser = await prisma.user.findUnique({
        where: { id: token.id as string },
        select: {
          schoolId: true,
          student: { select: { schoolId: true } },
          adminSchools: { select: { id: true } },
          teacherSchools: { select: { id: true } },
        },
      });

      token.schoolId =
        dbUser?.schoolId ??
        dbUser?.student?.schoolId ??
        dbUser?.adminSchools?.[0]?.id ??
        dbUser?.teacherSchools?.[0]?.id ??
        null;
    }

    return token;
  },

  async session({ session, token }) {
    session.user = {
      ...session.user,
      id: token.id as string,
      role: token.role as "SUPERADMIN" | "SCHOOLADMIN" | "TEACHER" | "STUDENT" | "PRINCIPAL" | "HOD",
      schoolId: token.schoolId as string | null,
      mobile: token.mobile as string | null,
      studentId: token.studentId as string | null,
    };

    return session;
  },
},


  pages: {
    signIn: "/admin/login",
  },

  secret: process.env.NEXTAUTH_SECRET,
};
