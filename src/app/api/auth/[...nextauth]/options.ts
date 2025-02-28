import { NextAuthOptions } from "next-auth";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import db from "@/lib/db";

// Check for Google OAuth credentials
if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    throw new Error("Google OAuth credentials are missing in environment variables");
}

export const authOptions: NextAuthOptions = {
    adapter: PrismaAdapter(db),
    providers: [
        // Credentials Provider
        CredentialsProvider({
            id: "credentials",
            name: "Credentials",
            credentials: {
                email: { label: "Email", type: "text" },
                password: { label: "Password", type: "password" },
            },
            async authorize(credentials) {

                if (!credentials) {
                    console.log("Credentials are missing");
                    throw new Error("Missing credentials");
                }
                const user = await db.user.findFirst({
                    where: {
                        OR: [
                            { email: credentials?.email },
                            { username: credentials?.email },
                        ],
                    },
                });

                if (!user) {
                    console.log("No user found with this email/username");
                    throw new Error("No user found with this email");
                }

                if (!user.isVerified) {
                    console.log("User found but not verified");
                    throw new Error("Please verify your account before login");
                }

                const isPasswordCorrect = credentials.password && user.password
                    ? await bcrypt.compare(credentials.password, user.password)
                    : false;

                if (isPasswordCorrect) {
                    console.log("Password matched, returning user", user);
                    return user;
                } else {
                    console.log("Incorrect password");
                    throw new Error("Incorrect password");
                }
            },
        }),
        // Google Provider
        GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            allowDangerousEmailAccountLinking: true, // Enable email account linking
            profile(profile) {
                console.log("Google profile received", profile);
                return {
                    id: profile.sub, // Google user ID
                    name: profile.name,
                    email: profile.email,
                    username: profile.email,
                    image: profile.picture,
                };
            },
        }),
    ],
    pages: {
        signIn: "/sign-in", // Custom sign-in page
    },
    session: {
        strategy: "jwt",
    },
    callbacks: {
        async signIn({ profile }) {
            console.log("Google signIn callback - profile", profile);
            if (!profile) {
                return false
            }

            // Upsert the user in your database
            const dbUser = await db.user.upsert({
                where: { email: profile.email },
                update: {
                    name: profile.name,
                    isVerified: true, // Assuming verified through Google
                },
                create: {
                    email: profile.email || "",
                    username: profile.email?.split('@')[0] || "", // Default username from email
                    name: profile.name,
                    isVerified: true, // Assuming verified through Google
                    isAcceptingMessage: true,
                    messages: {
                        create: [],
                    },
                },
            });

            console.log("User upserted in DB", dbUser);

            return true;
        },
        async jwt({ token, user }) {
            console.log("JWT callback - token", token);
            console.log("JWT callback - user", user);

            if (user) {
                token.id = user.id;
                token.isVerified = user.isVerified;
                token.isAcceptingMessage = user.isAcceptingMessage;
                token.username = user.username;
            }

            console.log("JWT after update - token", token);

            return token;
        },
        async session({ session, token }) {
            console.log("Session callback - session", session);
            console.log("Session callback - token", token);

            if (token) {
                session.user.id = token.id;
                session.user.isVerified = token.isVerified;
                session.user.isAcceptingMessage = token.isAcceptingMessage;
                session.user.username = token.username;
            }

            console.log("Session after update - session", session);

            return session;
        },
    },
    secret: process.env.NEXTAUTH_SECRET,
};
