"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/input";

export function StaffSelect({ staff, value }: { staff: { id: string; display_name: string }[]; value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <Select aria-label="従業員" className="h-9 w-44" value={value} onChange={(e) => {
      const sp = new URLSearchParams(params.toString());
      sp.set("staff", e.target.value);
      router.replace(`${pathname}?${sp.toString()}`);
    }}>
      {staff.map((s) => <option key={s.id} value={s.id}>{s.display_name}</option>)}
    </Select>
  );
}
