/** "dueDate" -> "Due date": the field the API complained about, in words a user knows. */
export function fieldLabel(path: string): string {
  const last = path.split(".").filter((p) => !/^\d+$/.test(p)).pop() ?? "";
  const words = last.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : "";
}

export function issueMessage(i: { path: string; message: string }): string {
  const label = fieldLabel(i.path);
  return label ? `${label}: ${i.message}` : i.message;
}
