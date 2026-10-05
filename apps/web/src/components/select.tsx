import type { SelectHTMLAttributes } from "react";
import { SelectField } from "./kit/inputs";

/** Legacy labelled select; renders the kit SelectField. */
export function Select({
  label,
  options,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  options: { value: string; label: string }[];
}) {
  return <SelectField label={label} options={options} {...props} />;
}
