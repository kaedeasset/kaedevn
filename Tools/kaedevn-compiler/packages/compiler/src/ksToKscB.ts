/**
 * KS → KSC 変換（戦略B: 上位集合埋め込み）。
 *
 * リンク後の単一 KS（`filesToKs` 出力、または単一ファイル）を、KSC コンパイラが
 * そのままコンパイルできる形へ「差分だけ」変換する。KS の `@シーンコマンド` は
 * P6-9（`execOp`）で KSC でも有効なため**素通し**する（＝KS→scenario.json 経路と
 * 同一 Op に落ちる。設計 Docs/Reports/2026/07/23/03）。
 *
 * 変換規則:
 *   `; コメント`            → `// コメント`（KSC の `;` は文終端でコメントでない）
 *   `*label`               → `label <slug>`
 *   `@jump target(.ks)`    → `jump <slug(target)>`
 *   `#話者` … `@l`区切り…  → `#話者` … `#`（複数ページは文字列行の配列、`@l`は落とす、
 *                            ブロックは構造行 or 単独 `#` で閉じる）
 *   `choice { "A"{…} … }`  → `const _cN = await engine.showChoice([...]); if (_cN==0){…}`
 *   `@bg`/`@ch`/その他 `@`  → 素通し（execOp）
 *   代入 / `if` / `else`    → 素通し（KSC ネイティブ）
 * 未対応（要フォロー・`//@ks:` へ退避し issue 化）:
 *   `@call` / `@return` / `@battle`（KSC ネイティブ形が別途必要）。
 *
 * 併存: `ksKscConvert.ts` の `ksToKsc`（戦略A・純コードへのトランスパイル）とは用途違い。
 * 本関数は「実行用の上位集合埋め込み」。
 */
import { toSlug } from './ksSlug.js';
import { splitWords } from './parser/splitCommandLine.js';

export interface KsToKscBIssue {
  severity: 'warning' | 'unsupported';
  /** 1-based の入力行番号。 */
  line: number;
  message: string;
}

export interface KsToKscBResult {
  ksc: string;
  issues: KsToKscBIssue[];
}

const RE_COMMENT = /^;(.*)$/;
const RE_LABEL = /^\*(\S+)\s*$/;
const RE_JUMP = /^@jump\s+(.+?)\s*$/;
const RE_DEFER = /^@(call|return|battle)\b/;
const RE_CHOICE_OPEN = /^choice\s*\{$/;
const RE_CHOICE_OPT = /^"((?:[^"\\]|\\.)*)"\s*\{$/;
const RE_KSC_KEYWORD =
  /^(const|let|var|if|else|for|while|do|return|function|label|jump|await|break|continue|switch|case|default|import|export)\b/;

/** KSC コード行らしいか（地の文＝ナレーションと区別する簡易判定）。ASCII の `= { } ( ) ;` か
 *  KSC キーワード始まりならコード。全角記号のみの本文はナレーション扱い（既知の限界: 半角括弧を
 *  含む本文はコード誤判定しうる）。 */
function looksLikeKscCode(t: string): boolean {
  if (t === '{' || t === '}') return true;
  if (/[={}();]/.test(t)) return true;
  return RE_KSC_KEYWORD.test(t);
}

export function ksToKscB(ks: string): KsToKscBResult {
  const issues: KsToKscBIssue[] = [];
  let choiceId = 0;

  // src の [start, end) 行を KSC 行配列へ変換する（choice 本文で再帰）。
  function convert(src: string[], base: number): string[] {
    const out: string[] = [];
    let inDialogue = false;
    const closeDlg = () => {
      if (inDialogue) {
        out.push('#');
        inDialogue = false;
      }
    };

    let i = 0;
    while (i < src.length) {
      const raw = src[i];
      const t = raw.trim();
      const lineNo = base + i + 1;

      if (t === '') {
        // 空行はセリフを閉じない（段落間の空行を許容）。
        out.push('');
        i++;
        continue;
      }

      // choice ブロック
      if (RE_CHOICE_OPEN.test(t)) {
        closeDlg();
        const { code, next } = lowerChoice(src, i, base);
        out.push(...code);
        i = next;
        continue;
      }

      // ページ待ち @l/@p/@r（単独行）はどこでも落とす（ダイアログ/ナレーションが内部で待つ）。
      if (t === '@l' || t === '@p' || t === '@r') {
        i++;
        continue;
      }

      // セリフ本文中の扱い
      if (inDialogue) {
        // 構造行（コマンド/ラベル/新話者/コメント/choice）に当たったらブロックを閉じる。
        if (t.startsWith('@') || t.startsWith('*') || t.startsWith('#') || t.startsWith(';')) {
          closeDlg();
          // フォールスルーして下の通常処理へ（i は進めない）。
        } else {
          // セリフ本文行 → そのまま（文字列トークン化される）。
          out.push(raw.replace(/\s+$/, ''));
          i++;
          continue;
        }
      }

      // 単独 `#`（既に KSC 形の明示クローズ）
      if (t === '#') {
        out.push('#');
        i++;
        continue;
      }

      // ; コメント → // コメント
      const cm = t.match(RE_COMMENT);
      if (cm) {
        out.push(`//${cm[1]}`);
        i++;
        continue;
      }

      // *label → label <slug>
      const lab = t.match(RE_LABEL);
      if (lab) {
        out.push(`label ${toSlug(lab[1])}`);
        i++;
        continue;
      }

      // @jump target → jump <slug>
      const jm = t.match(RE_JUMP);
      if (jm) {
        const target = splitWords(jm[1])[0];
        out.push(`jump ${toSlug(target)}`);
        i++;
        continue;
      }

      // @call / @return / @battle → 退避 + issue
      const df = t.match(RE_DEFER);
      if (df) {
        out.push(`//@ks: ${t}`);
        issues.push({
          severity: 'unsupported',
          line: lineNo,
          message: `@${df[1]} は戦略B変換で未対応（//@ks: に退避）。KSC ネイティブ形が別途必要。`,
        });
        i++;
        continue;
      }

      // #話者 → セリフブロック開始
      if (t.startsWith('#')) {
        out.push(t);
        inDialogue = true;
        i++;
        continue;
      }

      // @シーンコマンド（execOp）→ 素通し
      if (t.startsWith('@')) {
        out.push(raw.replace(/\s+$/, ''));
        i++;
        continue;
      }

      // 代入 / if / else / その他 KSC コード → 素通し。それ以外の裸テキストは地の文（空話者ダイアログ）。
      if (looksLikeKscCode(t)) {
        out.push(raw.replace(/\s+$/, ''));
      } else {
        out.push(`# ${JSON.stringify(t)}`);
      }
      i++;
    }

    closeDlg();
    return out;
  }

  // choice ブロックを showChoice + if/else-if へ lower する。
  // src[start] は `choice {`。戻り値 next は choice を閉じた `}` の次の行。
  function lowerChoice(
    src: string[],
    start: number,
    base: number,
  ): { code: string[]; next: number } {
    const cid = choiceId++;
    const opts: Array<{ text: string; body: string[] }> = [];
    let i = start + 1;

    while (i < src.length) {
      const t = src[i].trim();
      if (t === '}') {
        i++;
        break;
      } // choice 全体の閉じ
      if (t === '') {
        i++;
        continue;
      }
      const om = t.match(RE_CHOICE_OPT);
      if (om) {
        const text = om[1];
        const body: string[] = [];
        let depth = 1;
        i++;
        while (i < src.length && depth > 0) {
          const bt = src[i].trim();
          if (/\{$/.test(bt)) depth++;
          if (bt === '}') {
            depth--;
            if (depth === 0) {
              i++;
              break;
            }
          }
          body.push(src[i]);
          i++;
        }
        opts.push({ text, body });
        continue;
      }
      // choice 内の想定外行はスキップ（警告）。
      issues.push({
        severity: 'warning',
        line: base + i + 1,
        message: `choice ブロック内の想定外の行を無視: ${t}`,
      });
      i++;
    }

    const v = `_choice${cid}`;
    const arr = opts.map((o) => `{ text: ${JSON.stringify(o.text)} }`).join(', ');
    const code: string[] = [`const ${v} = await engine.showChoice([${arr}]);`];
    opts.forEach((o, k) => {
      code.push(`${k === 0 ? 'if' : 'else if'} (${v} == ${k}) {`);
      for (const bl of convert(o.body, base)) code.push(bl === '' ? '' : `  ${bl}`);
      code.push('}');
    });
    return { code, next: i };
  }

  const ksc = convert(ks.split('\n'), 0).join('\n');
  return { ksc, issues };
}
