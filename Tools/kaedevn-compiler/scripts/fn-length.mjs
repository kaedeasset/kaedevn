// 関数の長さ（行数）を測る。
// 使い方: node scripts/fn-length.mjs <フォルダかファイル>... [--max N]
// 関数宣言・メソッド・関数式・アロー関数を、宣言の行から閉じ括弧の行まで数える。
// --max を超えたものを出し、1 つでもあれば終了コード 1。
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const args = process.argv.slice(2);
let max = 200;
const roots = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--max') max = Number(args[++i]);
  else roots.push(args[i]);
}

function listTs(p) {
  const st = fs.statSync(p);
  if (st.isFile()) return p.endsWith('.ts') ? [p] : [];
  return fs.readdirSync(p).flatMap((n) => listTs(path.join(p, n)));
}

function nameOf(node, sf) {
  if (node.name) return node.name.getText(sf);
  const parent = node.parent;
  if (parent && ts.isVariableDeclaration(parent)) return parent.name.getText(sf);
  if (parent && ts.isPropertyAssignment(parent)) return parent.name.getText(sf);
  return '(無名)';
}

const over = [];
for (const file of roots.flatMap(listTs)) {
  const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    if (ts.isFunctionLike(node) && node.body) {
      const start = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
      const end = sf.getLineAndCharacterOfPosition(node.getEnd()).line;
      const lines = end - start + 1;
      if (lines > max) over.push({ file, line: start + 1, name: nameOf(node, sf), lines });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

for (const o of over.sort((a, b) => b.lines - a.lines)) {
  console.log(`${o.lines}\t${o.file}:${o.line}\t${o.name}`);
}
console.log(`max=${max} over=${over.length}`);
process.exit(over.length ? 1 : 0);
