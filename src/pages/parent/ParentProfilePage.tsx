import type { ReactNode } from "react";
import { ParentLayout } from "./ParentLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { useAuth } from "../../context/AuthContext";
import { useMyParent, useMyChildren } from "../../hooks/useParents";
import { AccountSecurityCards } from "../../components/account/AccountSecurityCards";

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="text-navy-400 w-32 shrink-0">{label}</dt>
      <dd className="text-navy-700 font-medium break-all">{value ?? <span className="text-navy-300 italic">—</span>}</dd>
    </div>
  );
}

/**
 * The parent's own account page, reached from the sidebar footer's identity
 * block like every other role's.
 *
 * Read-only apart from username and password: name/email/phone on the parent
 * record are maintained by an admin from /admin/parents/:id/edit, the same way
 * a student's details are, so there is one place a family's contact info can
 * change rather than two that can disagree.
 */
export default function ParentProfilePage() {
  const { session, profile, updateUsername, updatePassword } = useAuth();
  const { parent, loading: parentLoading } = useMyParent(session?.user?.id);
  const { children, loading: childrenLoading } = useMyChildren(parent?.id);

  return (
    <ParentLayout loading={parentLoading || childrenLoading}>
      <PageHeader title="Profile" />

      <div className="max-w-3xl flex flex-col gap-5">
        <Card className="p-8">
          <p className="text-lg font-semibold text-navy-700 mb-6">Your Information</p>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <InfoRow label="Parent ID" value={parent?.id} />
            <InfoRow label="Username" value={profile?.username} />
            <InfoRow label="First name" value={parent?.first_name} />
            <InfoRow label="Last name" value={parent?.last_name} />
            <InfoRow label="Email" value={parent?.email ?? profile?.email} />
            <InfoRow label="Phone" value={parent?.phone_number} />
            <InfoRow
              label="Children"
              value={
                children.length > 0
                  ? children.map((c) => `${c.first_name} ${c.last_name}`.trim()).join(", ")
                  : null
              }
            />
          </dl>
        </Card>

        <AccountSecurityCards
          username={profile?.username}
          updateUsername={updateUsername}
          updatePassword={updatePassword}
        />
      </div>
    </ParentLayout>
  );
}
