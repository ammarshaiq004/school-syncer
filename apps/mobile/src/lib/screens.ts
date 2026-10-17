/**
 * The screens this session has shown, newest first, so "Report a problem"
 * can say where the user was (the account screen itself is left out).
 */
let recent: string[] = [];

export function screenShown(path: string) {
  if (path === '/account') return;
  recent = [path, ...recent.filter((p) => p !== path)].slice(0, 5);
}

export const recentScreens = () => recent;
