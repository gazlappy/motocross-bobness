// Career rules: payouts, championship, unlocks and the garage, without a browser.
// Usage: node scripts/career-test.ts
import { BIKES } from '../src/bikes.ts';
import { SEASON, TIERS, YOU, buyBike, canEnter, eventConfig, newCareer, recordEvent, standings, startSeason } from '../src/career.ts';
import { rivalsFor } from '../src/session.ts';

let failed = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`);
  if (!ok) failed++;
};

const c = newCareer();
check(c.bike === '125' && c.cash === 0 && c.unlocked === 0, 'new career: a 125, no money, Rookie only');
check(canEnter(c, 0) && !canEnter(c, 1), 'the 125 can enter the Rookie Series and nothing else');

const rivals = rivalsFor('red');
check(rivals.length === 6 && !rivals.includes('Red Rider'), `rivals for red: ${rivals.join(', ')}`);
startSeason(c, 0, rivals, 'red');
const cfg = eventConfig(c);
check(cfg.bike === '125' && cfg.rivalBike === '125' && cfg.difficulty === 'easy' && cfg.rivals?.length === 6, 'Rookie event config: 125s, easy, fixed rivals');

// Win every race; score 4000 in the stunt bonus.
for (const e of SEASON) {
  const p = e.mode === 'quarry' ? recordEvent(c, null, 4000) : recordEvent(c, [YOU, ...rivals]);
  if (p.final) {
    check(p.final.position === 1 && p.final.unlocked === TIERS[1].name && p.final.title !== null, `season over: 1st, unlocked ${p.final.unlocked}`);
  }
}
const wins = SEASON.filter((e) => e.mode !== 'quarry').length;
check(c.season!.points[YOU] === wins * 25, `${wins} wins = ${wins * 25} points`);
check(standings(c)[0] === YOU, 'you lead the championship');
const expected = wins * 1500 + 1000 + 5000;
check(c.cash === expected, `cash $${c.cash} (expected $${expected})`);
check(c.unlocked === 1 && !canEnter(c, 1), 'Pro unlocked, but the 125 is not eligible');

check(buyBike(c, '250') && c.bike === '250' && c.cash === expected - BIKES['250'].price, 'bought the 250 and rode it');
check(canEnter(c, 1), 'the 250 can enter the Pro Series');
check(!buyBike(c, '250f'), `can't afford the 250F with $${c.cash}`);

// A poor Pro season: last in every race, no unlock.
startSeason(c, 1, rivals, 'red');
for (const e of SEASON) {
  const p = e.mode === 'quarry' ? recordEvent(c, null, 0) : recordEvent(c, [...rivals, YOU]);
  if (p.final) check(p.final.position === 7 && p.final.unlocked === null && p.final.bonus === 0, 'last every race: 7th, nothing unlocked');
}
check(c.unlocked === 1, 'Champions Cup still locked');

console.log(failed ? `\n${failed} career check(s) FAILED` : '\nAll career checks passed.');
if (failed) process.exit(1);
