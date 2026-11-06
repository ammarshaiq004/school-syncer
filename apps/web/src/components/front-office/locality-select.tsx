"use client";

import { SelectField } from "@/components/ui";
import { useApi } from "@/lib/use-api";

/** The family's area, from Settings > Localities. Renders nothing until the school has set some up. */
export function LocalitySelect({ defaultValue }: { defaultValue?: string | null }) {
  const list = useApi<{ id: string; name: string }[]>("/front-office/localities");
  if (!list.data?.length) return null;
  return (
    <SelectField
      label="Locality"
      name="localityId"
      defaultValue={defaultValue ?? ""}
      options={[{ value: "", label: "Not set" }, ...list.data.map((l) => ({ value: l.id, label: l.name }))]}
    />
  );
}
