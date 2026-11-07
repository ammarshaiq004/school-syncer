import { API_URL, getPlatformToken } from "./api";

/** Downloads a file from a console endpoint with the staff token (a plain link cannot send it). */
export async function downloadPlatformFile(path: string, filename: string) {
  const res = await fetch(`${API_URL}/platform${path}`, { headers: getPlatformToken() ? { Authorization: `Bearer ${getPlatformToken()}` } : {} });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.message ?? `Download failed (${res.status})`);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
