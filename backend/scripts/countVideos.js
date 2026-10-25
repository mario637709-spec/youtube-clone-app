const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const files = ['db.json', ...fs.readdirSync(DATA_DIR).filter(f => /^db_worker\d+\.json$/.test(f))];

let total = 0;
let nonShort = 0;
let shorts = 0;
const seen = new Set();

for (const file of files) {
  const filePath = path.join(DATA_DIR, file);
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const vids = raw.videos || {};
    for (const [id, v] of Object.entries(vids)) {
      if (seen.has(id)) continue;
      seen.add(id);
      total++;
      if (v.isShort) shorts++;
      else nonShort++;
    }
  } catch (err) {
    console.error(`Error reading ${file}:`, err.message);
  }
}

console.log(JSON.stringify({ total, nonShort, shorts }, null, 2));
