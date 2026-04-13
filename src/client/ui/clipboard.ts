const decoder = new TextDecoder();

export function decodeClipboardBase64(base64: string): string {
  if (!base64) return '';
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return decoder.decode(bytes);
}

export function handleClipboard(base64: string): void {
  try {
    const text = decodeClipboardBase64(base64);
    navigator.clipboard.writeText(text).catch(() => {});
  } catch { /* invalid base64 */ }
}