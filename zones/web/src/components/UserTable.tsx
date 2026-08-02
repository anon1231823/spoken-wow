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
};

export function UserTable({ users, currentUserId }: Props) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
            <th className="py-2 font-normal">Role</th>
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
              <td className="py-2">
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
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
