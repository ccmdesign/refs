import type { BoardsResponse } from "../types";

export function useBoards() {
  const data = useState<BoardsResponse | null>("boards-data", () => null);

  async function refresh() {
    data.value = await $fetch<BoardsResponse>("/api/boards");
  }

  if (!data.value) {
    refresh();
  }

  return { data, refresh };
}
