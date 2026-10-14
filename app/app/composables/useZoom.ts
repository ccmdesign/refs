const OPTIONS = [3, 4, 6] as const;
const KEY = "refs-columns";

export function useZoom() {
  const columns = useState<number>("refs-columns", () => {
    const stored = import.meta.client ? Number(localStorage.getItem(KEY)) : NaN;
    return (OPTIONS as readonly number[]).includes(stored) ? stored : 4;
  });

  function setColumns(n: number) {
    if (!(OPTIONS as readonly number[]).includes(n)) return;
    columns.value = n;
    if (import.meta.client) localStorage.setItem(KEY, String(n));
  }

  // +1 zooms in (fewer columns), -1 zooms out.
  function step(direction: number) {
    const i = OPTIONS.indexOf(columns.value as (typeof OPTIONS)[number]);
    const next = OPTIONS[Math.min(OPTIONS.length - 1, Math.max(0, i - Math.sign(direction)))];
    if (next) setColumns(next);
  }

  return { columns, options: OPTIONS, setColumns, step };
}
