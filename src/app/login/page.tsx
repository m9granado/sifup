import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { LoginForm } from "@/components/admin/LoginForm";

export default async function LoginPage() {
  if (await isAuthenticated()) redirect("/dashboard");

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
        <LoginForm />
      </section>
    </main>
  );
}
