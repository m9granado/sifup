"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Pencil, Plus, UserPlus } from "lucide-react";
import { createUserAction, resetUserPasswordAction, updateUserAction } from "@/app/actions";
import type { Role } from "@/lib/auth";
import type { AppUser, Player } from "@/lib/types";
import { Button, Card, Input, Modal, PageTitle } from "./SifupWorkspace";

const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  jugador: "Jugador",
  galleta: "Galleta",
};

function playerLabel(players: Player[], playerId: string | null) {
  if (!playerId) return "Sin vincular";
  return players.find((player) => player.id === playerId)?.name ?? "Jugador eliminado";
}

export function UsersWorkspace({ users, players }: { users: AppUser[]; players: Player[] }) {
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);
  const [editingUser, setEditingUser] = useState<AppUser | null>(null);
  const [resettingUser, setResettingUser] = useState<AppUser | null>(null);
  const [error, setError] = useState("");

  return (
    <>
      <PageTitle
        title="Usuarios"
        description="Cuentas de acceso al panel: admin, jugador y galleta."
        action={<Button onClick={() => setShowCreate(true)}><Plus size={16} />Nuevo usuario</Button>}
      />
      {error ? <p className="mb-4 rounded-md bg-(--gold)/15 px-3 py-2 text-sm font-bold text-(--gold)">{error}</p> : null}
      <Card className="space-y-3">
        <div className="overflow-x-auto rounded-lg border border-(--border)">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-(--border) bg-white/[0.04] text-[10px] font-black uppercase tracking-wide text-(--muted)">
              <tr>
                <th className="px-3 py-2 text-left">Email</th>
                <th className="px-3 py-2 text-center">Rol</th>
                <th className="px-3 py-2 text-center">Activo</th>
                <th className="px-3 py-2 text-left">Jugador vinculado</th>
                <th className="px-3 py-2 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-(--border) last:border-0 hover:bg-white/[0.04]">
                  <td className="px-3 py-3 font-bold text-white">{user.email}</td>
                  <td className="px-3 py-3 text-center text-xs font-bold text-(--muted)">{ROLE_LABEL[user.role]}</td>
                  <td className="px-3 py-3 text-center">
                    <span className={`rounded-full px-2 py-1 text-xs font-bold ${user.active ? "bg-(--green)/15 text-(--green)" : "bg-(--red)/15 text-(--red)"}`}>
                      {user.active ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-(--muted)">{playerLabel(players, user.playerId)}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-center gap-1">
                      <button type="button" onClick={() => setEditingUser(user)} className="rounded-md p-1.5 text-(--muted) hover:bg-white/[0.14]" aria-label={`Editar ${user.email}`} title="Editar">
                        <Pencil size={16} />
                      </button>
                      <button type="button" onClick={() => setResettingUser(user)} className="rounded-md p-1.5 text-(--muted) hover:bg-white/[0.14]" aria-label={`Resetear contraseña de ${user.email}`} title="Resetear contraseña">
                        <KeyRound size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-(--muted)">Todavia no hay usuarios.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      {showCreate ? (
        <Modal title="Nuevo usuario" onClose={() => setShowCreate(false)}>
          <CreateUserForm
            players={players}
            onCreated={() => {
              setShowCreate(false);
              router.refresh();
            }}
            onError={setError}
          />
        </Modal>
      ) : null}

      {editingUser ? (
        <Modal title={`Editar ${editingUser.email}`} onClose={() => setEditingUser(null)}>
          <EditUserForm
            user={editingUser}
            players={players}
            onSaved={() => {
              setEditingUser(null);
              router.refresh();
            }}
            onError={setError}
          />
        </Modal>
      ) : null}

      {resettingUser ? (
        <Modal title={`Resetear contraseña de ${resettingUser.email}`} onClose={() => setResettingUser(null)}>
          <ResetPasswordForm
            userId={resettingUser.id}
            onDone={() => {
              setResettingUser(null);
              router.refresh();
            }}
            onError={setError}
          />
        </Modal>
      ) : null}
    </>
  );
}

function CreateUserForm({ players, onCreated, onError }: { players: Player[]; onCreated: () => void; onError: (message: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("jugador");
  const [playerId, setPlayerId] = useState("");
  const [saving, setSaving] = useState(false);

  function submit() {
    if (!email.trim() || !password) return;
    setSaving(true);
    createUserAction({ email: email.trim(), password, role, playerId: playerId || null })
      .then(() => onCreated())
      .catch((err) => onError(err instanceof Error ? err.message : "No se pudo crear el usuario."))
      .finally(() => setSaving(false));
  }

  return (
    <div className="space-y-3 pb-2">
      <Input label="Email" value={email} onChange={setEmail} />
      <Input label="Contraseña" type="password" value={password} onChange={setPassword} />
      <label className="space-y-1 text-sm font-medium text-(--muted)">
        <span>Rol</span>
        <select className="h-10 w-full rounded-md border border-(--border) bg-(--panel-strong) px-3 text-sm text-white" value={role} onChange={(event) => setRole(event.target.value as Role)}>
          <option value="admin">Admin</option>
          <option value="jugador">Jugador</option>
          <option value="galleta">Galleta</option>
        </select>
      </label>
      {role === "jugador" ? (
        <label className="space-y-1 text-sm font-medium text-(--muted)">
          <span>Jugador vinculado</span>
          <select className="h-10 w-full rounded-md border border-(--border) bg-(--panel-strong) px-3 text-sm text-white" value={playerId} onChange={(event) => setPlayerId(event.target.value)}>
            <option value="">Sin vincular</option>
            {players.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}
          </select>
        </label>
      ) : null}
      <Button onClick={submit} disabled={saving || !email.trim() || !password}><UserPlus size={16} />Crear usuario</Button>
    </div>
  );
}

function EditUserForm({ user, players, onSaved, onError }: { user: AppUser; players: Player[]; onSaved: () => void; onError: (message: string) => void }) {
  const [role, setRole] = useState<Role>(user.role);
  const [active, setActive] = useState(user.active);
  const [playerId, setPlayerId] = useState(user.playerId ?? "");
  const [saving, setSaving] = useState(false);

  function submit() {
    setSaving(true);
    updateUserAction(user.id, { role, active, playerId: playerId || null })
      .then(() => onSaved())
      .catch((err) => onError(err instanceof Error ? err.message : "No se pudo actualizar el usuario."))
      .finally(() => setSaving(false));
  }

  return (
    <div className="space-y-3 pb-2">
      <label className="space-y-1 text-sm font-medium text-(--muted)">
        <span>Rol</span>
        <select className="h-10 w-full rounded-md border border-(--border) bg-(--panel-strong) px-3 text-sm text-white" value={role} onChange={(event) => setRole(event.target.value as Role)}>
          <option value="admin">Admin</option>
          <option value="jugador">Jugador</option>
          <option value="galleta">Galleta</option>
        </select>
      </label>
      {role === "jugador" ? (
        <label className="space-y-1 text-sm font-medium text-(--muted)">
          <span>Jugador vinculado</span>
          <select className="h-10 w-full rounded-md border border-(--border) bg-(--panel-strong) px-3 text-sm text-white" value={playerId} onChange={(event) => setPlayerId(event.target.value)}>
            <option value="">Sin vincular</option>
            {players.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}
          </select>
        </label>
      ) : null}
      <label className="flex items-center gap-2 text-sm font-medium text-(--muted)">
        <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
        <span>Cuenta activa</span>
      </label>
      <Button onClick={submit} disabled={saving}><Pencil size={16} />Guardar cambios</Button>
    </div>
  );
}

function ResetPasswordForm({ userId, onDone, onError }: { userId: string; onDone: () => void; onError: (message: string) => void }) {
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  function submit() {
    if (!password) return;
    setSaving(true);
    resetUserPasswordAction(userId, password)
      .then(() => onDone())
      .catch((err) => onError(err instanceof Error ? err.message : "No se pudo resetear la contraseña."))
      .finally(() => setSaving(false));
  }

  return (
    <div className="space-y-3 pb-2">
      <Input label="Contraseña nueva" type="password" value={password} onChange={setPassword} />
      <Button onClick={submit} disabled={saving || !password}><KeyRound size={16} />Guardar contraseña</Button>
    </div>
  );
}
