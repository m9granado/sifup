import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { LoginForm } from "@/components/admin/LoginForm";

export default async function LoginPage() {
  if (await isAuthenticated()) redirect("/dashboard");

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-10">
      <section className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-6">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">
            SIFUP
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-gray-950">
            Admin interno
          </h1>
          <p className="mt-2 text-sm leading-6 text-gray-600">
            Acceso privado para gestionar lista WhatsApp, pagos, equipos y resultados.
          </p>
        </div>
        <LoginForm />
      </section>
    </main>
  );
}
