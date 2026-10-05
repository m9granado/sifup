import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { sanitizeAuthorizeNext } from "@/lib/oauth-policy";
import { LoginForm } from "@/components/admin/LoginForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const safeNext = sanitizeAuthorizeNext(next);
  const user = await getCurrentUser();
  // A member mid-OAuth-consent can land here to switch to an admin account instead of bouncing to the dashboard.
  if (user && (user.role === "admin" || !safeNext)) redirect(safeNext ?? "/dashboard");

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-heading">
          <p className="login-kicker">
            SIFUP
          </p>
          <h1>
            Acceso SIFUP
          </h1>
          <p>
            Ingresa con tu correo y contraseña. Tus permisos determinan las secciones disponibles.
          </p>
        </div>
        <LoginForm next={safeNext} />
      </section>
    </main>
  );
}
