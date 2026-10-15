export type TaggerCheck = { ok: boolean; detail: string; models?: string[] };

export type DescribeInput = {
  prompt: string;
  imagePath: string;
  model?: string;
};

export interface TaggerAdapter {
  id: string;
  check(): Promise<TaggerCheck>;
  describe(input: DescribeInput): Promise<string>;
}
