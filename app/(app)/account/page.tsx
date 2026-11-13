import { requireProfile, ROLE_LABELS } from "@/lib/auth/session";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PasswordForm } from "./password-form";

export const metadata = { title: "アカウント" };

export default async function AccountPage() {
  const profile = await requireProfile();
  return (
    <div className="max-w-xl">
      <PageHeader title="アカウント" />
      <Card className="mb-4">
        <CardContent>
          <p className="text-lg font-bold">{profile.display_name}</p>
          <p className="text-sm text-muted">{ROLE_LABELS[profile.role]}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>パスワード変更</CardTitle>
        </CardHeader>
        <CardContent>
          <PasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
