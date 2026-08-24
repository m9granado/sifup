"use client";

import { useActionState } from "react";
import { LockKeyhole } from "lucide-react";
import { loginAction } from "@/app/actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, { error: "" });

  return (
    <form action={action} className="login-form">
      <div className="login-field">
        <label htmlFor="email">
          Correo
        </label>
        <input id="email" name="email" type="email" required autoComplete="email" placeholder="tu@correo.com" />
      </div>
      <div className="login-field">
        <label htmlFor="password">
          Contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
        />
      </div>
      {state.error ? (
        <p className="login-error">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="login-submit"
      >
        <LockKeyhole size={18} />
        {pending ? "Entrando..." : "Entrar"}
      </button>
    </form>
  );
}
