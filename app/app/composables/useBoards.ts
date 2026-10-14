import type { BoardTreeNode, BoardsResponse } from "../types";

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

// Every board at every depth.
export function countBoards(nodes: BoardTreeNode[]): number {
  return nodes.reduce((n, node) => n + 1 + countBoards(node.children), 0);
}
