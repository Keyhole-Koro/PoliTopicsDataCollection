export const instruction = `【目的】
国会議事録をAIで要約し、一般の読者にもわかりやすく説明すること。専門用語や制度に不慣れな人でも「何が決まり、何が議論され、次に何が起こるか」が直感的に掴める要約データを作成してください。

各セクションとフィールドの**使用目的**を理解した上で、忠実に出力してください。
この構造は、人間が読むレポートとしてだけでなく、システムが発言と要約を対応付けて処理できるように設計されています。

---

1. **基本情報 (Metadata)**
 会議に関するメタデータを記載してください：タイトル、開催日、開催機関、カテゴリなど。
 - タイトルは「要点がひと目で分かる見出し型」。例：\`補助金の審査厳格化を政府が表明、来月までに新基準案\`
 - 組織名・会の種類はメタデータで保持し、descriptionでは優先度を下げる

2. **全体の要約 (Summary)**
 会議全体の要点や結論を簡潔にまとめてください。箇条書き中心で、数値や件数はMarkdownの表・リストの利用を推奨（任意）。
 - \`based_on_orders\`: この要約がどの dialogs.order をまとめているかを配列で示す
 - \`summary\`: 会話全体の要点

3. **やさしい要約 (SoftSummary)**
 政治や専門用語に馴染みのない読者向けに、背景や文脈も含めてわかりやすく丁寧に説明してください。

4. **中間要約 (MiddleSummary)**
 議論の重要な転換点や話題ごとのまとまりを、構成順に並べて要約してください。

5. **発言ごとの要約 (Dialogs)**
 各発言について、以下の情報を含めて記述してください：
 - \`order\`: 発言番号
 - \`summary\`: 発言の主旨を簡潔に要約
 - \`soft_language\`: 一般読者にも伝わるように、やさしく丁寧に言い換えた文章
   - **ただし次を厳守**：
     - 原文の構成や順序を崩さない（削除・追加・並び替えをしない）
     - トーン（敬体/常体・語尾など）を維持
     - 固有名詞・数値・否定条件は落とさない
 - \`response_to\`: この発言がどの発言に反応しているか

 ※ 話者名・所属・役職は RawSpeechRecord から後段で付与するため、ここでは出力不要。

6. **参加者情報 (Participants)**
 主な話者ごとに、名前・役職・発言内容の要旨をまとめてください。

7. **用語の解説 (Terms)**
 専門的または一般にはわかりにくい用語について、簡潔で明確な定義を記述してください。

8. **キーワード抽出 (Keywords)**
 議論の焦点となる用語やトピックを抽出し、重要度 (high / medium / low) を分類してください。

---

**記述スタイルのヒント**
- descriptionは「パッと見で要点が伝わる」短文（1〜2文）＋必要なら箇条書き
- 図表は挿入せず、必要な表現は各 \`summary\` 内にMarkdownで
`;

export const output_format = `### 出力フォーマット

{
  "id": "文字列 (議事録ID)",
  "title": "要点がひと目で分かる見出し",
  "date": "開催日 (YYYY-MM-DD)",
  "imageKind": "会議録 | 目次 | 索引 | 附録 | 追録",
  "session": 数字,
  "nameOfHouse": "衆議院または参議院",
  "nameOfMeeting": "会議名",
  "category": "カテゴリ",
  "description": "1〜2文の説明＋必要に応じて箇条書き",

  "summary": {
    "based_on_orders": [1,2,3],
    "summary": "会話全体の要点"
  },
  "soft_summary": {
    "based_on_orders": [1,2,3],
    "summary": "やさしい言葉での説明"
  },
  "middle_summary": [
    {
      "based_on_orders": [4,5],
      "summary": "中間要約"
    }
  ],
  "dialogs": [
    {
      "order": 1,
      "summary": "発言内容の要約",
      "soft_language": "原文を崩さずやさしく言い換えた文章",
      "response_to": [
        {
          "order": 0,
          "reaction": "agree | disagree | neutral | question | answer"
        }
      ]
    }
  ],
  "participants": [
    {
      "name": "話者名",
      "summary": "この人の発言要旨"
    }
  ],
  "terms": [
    {
      "term": "専門用語",
      "definition": "その説明"
    }
  ],
  "keywords": [
    {
      "keyword": "代表表記",
      "priority": "high | medium | low"
    }
  ]
}
`;


export const chunk_prompt = (input: string): string => {
  return `${instruction}\n${output_format}\n###　入力\n${input}`;
}

export const compose_prompt = (input: string): string => {
  return `${instruction}\n${output_format}\n###　入力\n${input}`;
};

export const prompt = (): string => {
  return `${instruction}\n${output_format}`;
}