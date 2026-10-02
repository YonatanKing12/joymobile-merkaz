// Shopify's Liquid tokenizer ends an output tag at the first "}" ({{ … }}?), even inside a quoted string,
// and then rejects the whole file on upload (the GitHub sync skips it silently). Theme Check does not catch
// this, so: inside every {{ … }} outside comment/raw blocks, the first "}" must be the closing "}}".
const fs = require('fs');
let bad = 0;
for (const file of process.argv.slice(2)) {
  const src = fs.readFileSync(file, 'utf8')
    .replace(/\{%-?\s*comment\s*-?%\}[\s\S]*?\{%-?\s*endcomment\s*-?%\}/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\{%-?\s*raw\s*-?%\}[\s\S]*?\{%-?\s*endraw\s*-?%\}/g, (m) => m.replace(/[^\n]/g, ' '));
  for (let i = src.indexOf('{{'); i !== -1; i = src.indexOf('{{', i + 2)) {
    const close = src.indexOf('}', i + 2);
    if (close !== -1 && src[close + 1] !== '}') {
      const line = src.slice(0, i).split('\n').length;
      console.log(`::error file=${file},line=${line}::"}" inside {{ … }} (Shopify rejects this file): ${src.slice(i, close + 1).replace(/\s+/g, ' ').slice(0, 120)}`);
      bad++;
    }
  }
}
process.exit(bad ? 1 : 0);
