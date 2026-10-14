const KEY = "refs-theme";
type Theme = "light" | "dark";

// Light unless the user has chosen dark. nuxt.config.ts applies the stored
// choice inline before first paint.
export function useTheme() {
  const theme = useState<Theme>("refs-theme", () => {
    if (!import.meta.client) return "light";
    return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  });

  function toggle() {
    theme.value = theme.value === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = theme.value;
    localStorage.setItem(KEY, theme.value);
  }

  return { theme, toggle };
}
