"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

export default function UserTable({ users, currentUserId }: Props) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function changeRole(userId: string, role: Role) {
    setPendingId(userId);
    setError(null);

    const { error } = await authClient.admin.setRole({ userId, role });

    if (error) {
      setError(error.message ?? "Could not change that role.");
    } else {
      router.refresh();
    }
    setPendingId(null);
  }

  return (
    <>
      {error && (
        <p role="alert" className="text-destructive mb-3 text-sm">
          {error}
        </p>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground border-b text-left text-xs">
            <th className="py-2 pr-3 font-normal">Name</th>
            <th className="py-2 pr-3 font-normal">Email</th>
            <th className="py-2 pr-3 font-normal">Joined</th>
            <th className="py-2 font-normal">Role</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} className="border-b last:border-0">
              <td className="py-2 pr-3">{user.name}</td>
              <td className="text-muted-foreground py-2 pr-3">{user.email}</td>
              <td className="text-muted-foreground py-2 pr-3 whitespace-nowrap">
                {new Date(user.createdAt).toISOString().slice(0, 10)}
              </td>
              <td className="py-2">
                {user.id === currentUserId ? (
                  // No select for yourself: demoting the only admin would lock the last
                  // account out of the only page that can undo it, leaving SQL as the
                  // only way back in.
                  <span className="flex items-center gap-2">
                    <Badge variant="outline" className="uppercase">
                      {user.role ?? "member"}
                    </Badge>
                    <span className="text-muted-foreground text-xs">you</span>
                  </span>
                ) : (
                  <Select
                    value={user.role ?? "member"}
                    disabled={pendingId === user.id}
                    onValueChange={(value) => changeRole(user.id, value as Role)}
                  >
                    <SelectTrigger
                      className="w-40"
                      aria-label={`Role for ${user.email}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((role) => (
                        <SelectItem key={role} value={role}>
                          {role}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
