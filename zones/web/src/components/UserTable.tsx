"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";
import { ROLES, type Role } from "@/lib/permissions";

type AdminUser = {
  id: string;
  name: string;
  email: string;
  role?: string | undefined;
  createdAt: Date;
};

type Props = {
  users: AdminUser[];
  /** The signed-in admin, whose own role is deliberately not editable here. */
  currentUserId: string;
  /** Who has an ElevenLabs key on file. Presence only -- no value reaches this table. */
  keyedUserIds: string[];
};

export function UserTable({ users, currentUserId, keyedUserIds }: Props) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Cleared keys are dropped from this set rather than refetched: the row is the only
  // thing that changed, and router.refresh() would rebuild the whole table under the
  // pointer for a one-cell edit.
  const [keyed, setKeyed] = useState(() => new Set(keyedUserIds));

  async function clearKey(userId: string) {
    setPendingId(userId);
    setError(null);

    const response = await fetch(`/api/profile/api-key?userId=${encodeURIComponent(userId)}`, {
      method: "DELETE",
    });

    if (!response.ok) setError("Could not clear that key.");
    else {
      setKeyed((current) => {
        const next = new Set(current);
        next.delete(userId);
        return next;
      });
    }

    setPendingId(null);
  }

  async function changeRole(userId: string, role: Role) {
    setPendingId(userId);
    setError(null);

    const { error } = await authClient.admin.setRole({ userId, role });

    if (error) setError(error.message ?? "Could not change that role.");
    else router.refresh();

    setPendingId(null);
  }

  return (
    <>
      {error && (
        <p role="alert" className="mb-3 text-bad">
          {error}
        </p>
      )}

      <table className="w-full">
        <thead className="text-left text-xs text-faint">
          <tr className="border-b border-border">
            <th className="py-2 pr-3 font-normal">Name</th>
            <th className="py-2 pr-3 font-normal">Email</th>
            <th className="py-2 pr-3 font-normal">Joined</th>
            <th className="py-2 pr-3 font-normal">Role</th>
            <th className="py-2 font-normal">Key</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} className="border-b border-border last:border-0">
              <td className="py-2 pr-3">{user.name}</td>
              <td className="py-2 pr-3 text-muted">{user.email}</td>
              <td className="py-2 pr-3 whitespace-nowrap text-muted">
                {new Date(user.createdAt).toISOString().slice(0, 10)}
              </td>
              <td className="py-2 pr-3">
                {user.id === currentUserId ? (
                  // No select for yourself: demoting the only admin would lock the last
                  // account out of the only page that can undo it, leaving SQL as the
                  // only way back in.
                  <span className="flex items-center gap-2">
                    <span className="rounded border border-border px-1.5 text-xs uppercase">
                      {user.role ?? "member"}
                    </span>
                    <span className="text-xs text-faint">you</span>
                  </span>
                ) : (
                  <select
                    value={user.role ?? "member"}
                    disabled={pendingId === user.id}
                    aria-label={`Role for ${user.email}`}
                    onChange={(event) => changeRole(user.id, event.target.value as Role)}
                  >
                    {ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                )}
              </td>
              <td className="py-2 whitespace-nowrap">
                {keyed.has(user.id) ? (
                  <span className="flex items-center gap-2">
                    <span aria-label="key set">✓</span>
                    <button
                      type="button"
                      disabled={pendingId === user.id}
                      onClick={() => clearKey(user.id)}
                      className="text-xs text-muted hover:text-bad disabled:opacity-40"
                    >
                      Clear
                    </button>
                  </span>
                ) : (
                  <span className="text-faint">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
