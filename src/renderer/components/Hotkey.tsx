export function Hotkey({ value }: { value: string }): React.JSX.Element {
  const isMac = navigator.userAgent.includes('Macintosh');
  const labels: Record<string, string> = { CommandOrControl: isMac ? '⌘' : 'Ctrl', Command: '⌘', Control: 'Ctrl', Shift: 'Shift', Alt: isMac ? 'Option' : 'Alt' };
  return <span className="hotkey-keys" aria-label={value}>{value.split('+').map((key, index) => <kbd key={`${key}-${index}`}>{labels[key] || key}</kbd>)}</span>;
}
