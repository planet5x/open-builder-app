export function formatDeleteConfirmation(
  template: string,
  name: string,
): string {
  return template.replace("{name}", name);
}
