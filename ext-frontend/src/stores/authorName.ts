const KEY = "meetily-author-name";

export function loadAuthorName(): string | null {
  return localStorage.getItem(KEY);
}

export function saveAuthorName(name: string): void {
  localStorage.setItem(KEY, name);
}
