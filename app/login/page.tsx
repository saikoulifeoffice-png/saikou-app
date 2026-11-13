import { redirect } from "next/navigation";
import { BrandMark } from "@/components/nav-config";
import { getCurrentProfile } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const metadata = { title: "ログイン" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getCurrentProfile()) redirect("/home");
  const { next } = await searchParams;
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-navy-900 px-4 py-10">
      <div className="mb-8">
        <BrandMark className="scale-125" />
      </div>
      <div className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-xl">
        <h1 className="mb-1 text-lg font-bold text-navy-900">ログイン</h1>
        <p className="mb-5 text-sm text-muted">アカウントは代表が発行します</p>
        <LoginForm next={next} />
      </div>
      <p className="mt-6 text-xs text-navy-300">© 株式会社saikou</p>
    </div>
  );
}
