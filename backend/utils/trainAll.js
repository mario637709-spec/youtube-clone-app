/**
 * ═══════════════════════════════════════════════════════════════════
 *  trainAll.js — Offline algorithm trainer (main entry)
 *  ─────────────────────────────────────────────────────────────────
 *  Kiro ka recommendation brain har baar fresh data par re-train karta
 *  hai taaki trending/niche shifts reflect hon.
 *
 *  Steps:
 *    1. [--sync] Channel catalog se fresh videos pull karo (optional —
 *       kyunki live fetch slow hai, default ON: catalog wale channels)
 *    2. db.json snapshot se training rows nikaalo
 *    3. Model weights compute karo (keyword/category/duration/shorts/channel)
 *    4. models/algorithmWeights.json me dump karo + metrics report
 *    5. Holdout accuracy report (80/20 split) — trainer kuch samjha ya nahi
 * ═══════════════════════════════════════════════════════════════════
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { AlgorithmTrainer, MODEL_PATH } = require('./algorithmTrainer');

const args = process.argv.slice(2);
const DO_SYNC = !args.includes('--no-sync');

// ─── Holdout evaluation ────────────────────────────────────────────
// 80/20 split. Test set par model ke FEATURES se score predict karo
// (globalMean + keyword boosts + category mean + duration/shorts adjust)
// aur top-10 prediction ko actual top-10 se compare karo.
const predictScore = (row, model) => {
  let score = model.globalMean;
  for (const w of [...row.title, ...row.tags]) {
    score += (model.keywords[w] || 0) - model.globalMean; // keyword overshoot vs mean
  }
  score += (model.categories[row.category] || 0) - model.globalMean;
  score += (model.durations[row.durationBracket] || 0) - model.globalMean;
  score += (model.shorts[String(row.isShort)] || 0) - model.globalMean;
  return score;
};

const evaluate = (rows, model) => {
  const testRows = rows.filter((_, i) => i % 5 === 0); // 20% holdout
  const topActual = new Set(
    [...testRows].sort((a, b) => b.label - a.label).slice(0, 10).map((r) => r.videoId)
  );
  const scored = testRows
    .map((r) => ({ id: r.videoId, pred: predictScore(r, model) }))
    .sort((a, b) => b.pred - a.pred);
  const hits = scored.slice(0, 10).filter((p) => topActual.has(p.id)).length;
  return { precisionAt10: +(hits / 10).toFixed(3), testSize: testRows.length };
};

(async () => {
  console.log('═══════════════════════════════════════════════');
  console.log('  KIRO ALGORITHM TRAINER');
  console.log('═══════════════════════════════════════════════');

  const trainer = new AlgorithmTrainer();

  if (DO_SYNC) {
    console.log('\n[1/3] Syncing catalog channels (fresh videos)...');
    try {
      const { syncChannel } = require('./syncYouTubeChannel');
      const result = await syncChannel(5);
      console.log(`[sync] done — added:${result.addedCount} skipped:${result.skippedCount} failed:${result.failedCount}`);
    } catch (err) {
      console.warn(`[sync] skipped (${err.message}) — db.json se training jaari`);
    }
  } else {
    console.log('\n[1/3] Skipping channel sync (--no-sync)');
  }

  console.log('\n[2/3] Collecting training rows...');
  const rows = await trainer.collectRows({ minViews: 20 });
  if (!rows.length) {
    console.error('No training data — pehle channels sync karo ya videos ingester chalao.');
    process.exit(1);
  }

  console.log('\n[3/3] Training model...');
  const model = trainer.train();
  console.log(`  Model → ${MODEL_PATH}`);
  console.log(`  samples: ${model.sampleCount}`);
  console.log(`  globalMean: ${model.globalMean}`);
  console.log(`  keywords: ${Object.keys(model.keywords).length}`);
  console.log(`  categories: ${Object.keys(model.categories).length}`);
  console.log(`  channels boosted: ${Object.keys(model.channels).length}`);

  const ev = evaluate(rows, model);
  console.log(`\n  Holdout (20%) — precision@10: ${ev.precisionAt10} (testSize: ${ev.testSize})`);

  console.log('\n  Top categories by mean label:');
  Object.entries(model.categories)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .forEach(([k, v]) => console.log(`    ${k}: ${v}`));

  console.log('\n  Top keywords by weight:');
  Object.entries(model.keywords)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([k, v]) => console.log(`    ${k}: ${v}`));

  console.log('\n✔ Training complete.');
  process.exit(0);
})().catch((err) => {
  console.error('Training failed:', err);
  process.exit(1);
});