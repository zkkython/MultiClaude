export function shouldAutoFocusTerminal(
  shouldFocus: boolean,
  doc: Pick<Document, 'querySelector'> = document,
): boolean {
  if (!shouldFocus) return false;
  return !doc.querySelector('.screen-workspace[data-inline-editing="1"]');
}
