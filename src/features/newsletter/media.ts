export function getTrimmedImageUrl(url?: string | null) {
  const trimmedUrl = url?.trim();
  return trimmedUrl ? trimmedUrl : null;
}
