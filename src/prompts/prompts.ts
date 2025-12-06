export const PROMPT_VERSION = "2025-10-02.1";

export const instruction_common = `【目的】
国会議事録をAIで要約し、一般の読者にもわかりやすく説明すること。専門用語や制度に不慣れな人でも「何が決まり、何が議論され、次に何が起こるか」が直感的に掴める要約データを作成してください。

タスクは2モード:
- chunk: 会議全体の一部（発言群）を処理し、reduce統合を見越した middle_summary を中心に出力。soft_summary は必須。
- reduce: 全 chunk 出力（特に middle_summary と participants）を統合し、会議全体の最終 summary に加え、title / category / description / date / participants を生成。

厳守:
- middle_summary は「1トピック=1要点」。重複回避、結論/対立/未決/宿題/担当/期限/金額を明示できる範囲で。
- すべての要点に based_on_orders（発言 order 配列）を付与。
- 余談や定型挨拶は除外。推測や創作は禁止。
- すべての出力に prompt_version を含める（現在値: ${PROMPT_VERSION}）。`;

export const instruction_chunk = `【chunkモードの出力指針】
- middle_summary（必須）: reduce統合に最適化した最小要点の列。
- soft_summary（必須）: このchunk範囲を一般読者向けにやさしく説明。
- dialogs/participants/terms/keywords: このchunkに現れた範囲で必要なもののみ。
- title / category / description / summary / date は出力しない（reduceで決定）。
補足:
- middle_summaryのsummaryには必ず論点の背景（誰が、どの立場で、何を主張/回答したか）を1文以上で含め、based_on_ordersの順序と自然に対応させること。
- soft_summaryは「このchunkの意味」を新規読者にストーリーとして伝える。個人名・役職・具体的数値や締切が登場した場合は、分かる範囲で自然文に織り込む。
- participantsのsummaryでは、reduce処理者が議事録原文を追い直さなくても意図を理解できるよう、1〜2文で発言意図とアクションを明示する。`;

export const instruction_reduce = `【reduceモードの出力指針】
- 全chunkの middle_summary を統合し、重複排除・矛盾解消・網羅性確保。
- participants は chunk由来の重複/別表記を正規化し、一人につき要旨を統合。役職や所属は可能なら統合、曖昧なら空欄可。
- 出力は title / category / description / date / summary / participants。
- summary 構成（推奨）: 決定事項 / 主要論点と立場 / 未決・宿題 / 次に起こること（担当・期限） / 重要数値。
- based_on_orders は統合後に参照した order のユニオンまたは代表範囲。
- dialogs / terms / keywords は出力しない。`;

export const output_format_chunk = `### 出力フォーマット（chunk）

{
  "prompt_version": "${PROMPT_VERSION}",
  "id": "文字列 (議事録ID 例: issueID)",

  "middle_summary": [
    {
      "based_on_orders": [4,5],
      "summary": "reduceで統合しやすい1要点（決定/対立/未決/宿題/担当/期限/金額を簡潔に）"
    }
  ],

  "soft_summary": {
    "based_on_orders": [1,2,3],
    "summary": "やさしい言葉での説明（このchunk範囲）"
  },

  "dialogs": [
    {
      "order": 1,
      "summary": "発言内容の要約",
      "soft_language": "原文を崩さずやさしく言い換えた文章",
    }
  ],

  "participants": [
    { "name": "話者名", "position": "役職（不明可）", "summary": "この人の発言要旨（chunk範囲）" }
  ],

  "terms": [
    { "term": "専門用語", "definition": "その説明（chunkで出たもののみ）" }
  ],

  "keywords": [
    { "keyword": "代表表記", "priority": "high | medium | low" }
  ]
}
`;

export const output_format_reduce = `### 出力フォーマット（reduce）

{
  "prompt_version": "${PROMPT_VERSION}",
  "id": "文字列 (議事録ID 例: issueID)",

  "title": "要点がひと目で分かる見出し（最終）",
  "category": "会議全体を表すカテゴリ（主要テーマや種別を簡潔に）",
  "description": "1〜2文＋必要なら箇条書きで全体像をひと目で伝える",
  "date": "開催日 (YYYY-MM-DD) または 空文字",

  "summary": {
    "based_on_orders": [1,2,3,4,5],
    "summary": "会議全体の最終要約（決定事項/主要論点/未決・宿題/次に起こること/重要数値を簡潔に）"
  },

  "participants": [
    {
      "name": "話者名（重複統合後）",
      "position": "役職（分かれば）",
      "summary": "この人の発言要旨（会議全体を統合）",
      "based_on_orders": [10,14,29] // 代表となる発言 order
    }
  ]
}
`;

export const chunk_prompt = (input: string): string => {
  return `${instruction_common}\n${instruction_chunk}\n${output_format_chunk}\n### 入力\n${input}`;
};

export const reduce_prompt = (input: string): string => {
  return `${instruction_common}\n${instruction_reduce}\n${output_format_reduce}\n### 入力\n${input}`;
};
