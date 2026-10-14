import { boardTreePayload } from "../../utils/boards.ts";
import { library } from "../../utils/lib.ts";

export default defineEventHandler(() => {
  const lib = library();
  return boardTreePayload(lib);
});
