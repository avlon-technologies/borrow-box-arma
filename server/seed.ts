/**
 * Demo community. Every scenario is created through the real domain
 * functions (with the clock moved back in time), so seeded history obeys the
 * same rules as anything a person does in the app.
 *
 *   node server/seed.ts --reset    wipe data/ and reseed
 */
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { type DB, defaultDataDir, openDatabase, run, one, ROOT } from './db.ts';
import { addDays, getClock, setClock, today } from './dates.ts';
import * as L from './domain/loans.ts';

const PHOTO_DIR = join(ROOT, 'server', 'seed', 'photos');

const people = [
  { id: 'maya', name: 'Maya Okafor', first: 'Maya', hood: 'Riverside', hue: 18,
    bio: 'Weekend baker and serial DIY-er. Happy to show you how the drill works.' },
  { id: 'sam', name: 'Sam Whitfield', first: 'Sam', hood: 'Elm Street', hue: 150,
    bio: 'Outdoorsy dad of two. If it lives in a garage, I probably have one.' },
  { id: 'priya', name: 'Priya Natarajan', first: 'Priya', hood: 'Maple Court', hue: 265,
    bio: 'Movie nights, stargazing and very competitive board games.' },
  { id: 'theo', name: 'Theo Martin', first: 'Theo', hood: 'Harbour Lane', hue: 205,
    bio: 'I host the street party every summer. Ask me about tables.' },
];

interface SeedItem {
  key: string;
  owner: string;
  title: string;
  category: string;
  maxDays: number;
  photo: string[];
  description: string;
  pickup: string;
  care: string;
}

const itemsToSeed: SeedItem[] = [
  { key: 'drill', owner: 'maya', title: 'Cordless drill & bit set', category: 'Tools', maxDays: 7, photo: ['drill.jpg'],
    description: '18V drill/driver with two batteries, a charger and a 40-piece bit set. Great for shelves, flat-pack and fence repairs.',
    pickup: 'Porch pickup on Riverside Ave — I’ll leave it in the blue bin if I’m out.',
    care: 'Please pop the batteries back on the charger before returning.' },
  { key: 'mixer', owner: 'maya', title: 'Stand mixer', category: 'Kitchen', maxDays: 5, photo: ['stand-mixer.jpg'],
    description: 'Tilt-head stand mixer with dough hook, whisk and paddle. Has made hundreds of birthday cakes.',
    pickup: 'Evenings after 6 work best. It’s heavy — bring a bag or a box.',
    care: 'Hand-wash the attachments, please (not the dishwasher).' },
  { key: 'sewing', owner: 'maya', title: 'Sewing machine', category: 'Hobbies', maxDays: 14, photo: ['sewing-machine.jpg'],
    description: 'Reliable mechanical sewing machine, perfect for hems, curtains and costume emergencies. Comes with spare bobbins and needles.',
    pickup: 'Pickup from my place on Riverside; I can give a five-minute threading lesson.',
    care: 'Please use the dust cover and keep the foot pedal cable untangled.' },
  { key: 'ladder', owner: 'maya', title: 'Wooden step ladder', category: 'Home & Garden', maxDays: 3, photo: ['ladder.jpg'],
    description: 'Sturdy six-step wooden ladder for painting ceilings, hanging lights and reaching that one high shelf.',
    pickup: 'It folds flat and fits in most hatchbacks with the seats down.',
    care: 'Wipe off any paint splashes before bringing it back.' },
  { key: 'tent', owner: 'sam', title: 'Four-person camping tent', category: 'Outdoors', maxDays: 10, photo: ['tent.jpg'],
    description: 'Roomy dome tent that pitches in ten minutes. Includes footprint, pegs and a mallet.',
    pickup: 'Garage on Elm Street — text me through BorrowBox and I’ll open it up.',
    care: 'If it comes back wet, please hang it to dry before packing. Mould is the enemy!' },
  { key: 'paddle', owner: 'sam', title: 'Inflatable paddleboard', category: 'Outdoors', maxDays: 4, photo: ['paddleboard.jpg'],
    description: 'Stable 10’6” inflatable SUP with paddle, pump, leash and a backpack to carry it all.',
    pickup: 'Elm Street, mornings before 9 or after 5.',
    care: 'Rinse with fresh water and let it dry before rolling.' },
  { key: 'trailer', owner: 'sam', title: 'Bike cargo trailer', category: 'Outdoors', maxDays: 7, photo: ['bike-trailer.jpg'],
    description: 'Sturdy two-wheel cargo trailer that hitches to most adult bikes. Hauls groceries, camping gear or a week of farmers-market finds.',
    pickup: 'I’ll help you fit the hitch the first time.',
    care: 'Check the hitch pin is clipped in before every ride.' },
  { key: 'backpack', owner: 'sam', title: '65 L hiking backpack', category: 'Outdoors', maxDays: 14, photo: ['backpack.jpg'],
    description: 'Adjustable trekking pack with rain cover. Has done the West Coast Trail twice.',
    pickup: 'Anytime — just message first.',
    care: 'Empty all pockets (I’ve found trail mix from 2021).' },
  { key: 'projector', owner: 'priya', title: 'Portable movie projector', category: 'Electronics', maxDays: 5, photo: ['projector.jpg'],
    description: '1080p projector with a 100” pull-up screen and a little Bluetooth speaker. Backyard movie nights, sorted.',
    pickup: 'Maple Court, unit 4. Weeknights are easiest.',
    care: 'Let it cool down before packing it in the case.' },
  { key: 'telescope', owner: 'priya', title: 'Tabletop telescope', category: 'Hobbies', maxDays: 7, photo: ['telescope.jpg'],
    description: 'Compact telescope on a tripod — light enough for the balcony, strong enough for Saturn’s rings on a clear night.',
    pickup: 'I’ll show you how to align the finder scope.',
    care: 'Keep the lens caps on whenever it’s not in use.' },
  { key: 'games', owner: 'priya', title: 'Board game night box', category: 'Hobbies', maxDays: 14, photo: ['board-games.jpg'],
    description: 'Six crowd-pleasers for 2–6 players, from quick party games to a long strategy evening.',
    pickup: 'Maple Court, any evening.',
    care: 'Please count the pieces back in — there’s a checklist in the lid.' },
  { key: 'waffles', owner: 'priya', title: 'Belgian waffle iron', category: 'Kitchen', maxDays: 5, photo: ['waffle-iron.jpg'],
    description: 'Makes thick, fluffy Belgian waffles in four minutes. Comes with my grandmother’s batter recipe card.',
    pickup: 'Maple Court, any evening — I’ll throw in a bag of pearl sugar.',
    care: 'Let it cool, then wipe the plates with a damp cloth (no soap, they’re seasoned).' },
  { key: 'tables', owner: 'theo', title: 'Garden party set', category: 'Party', maxDays: 3, photo: ['party-tables.jpg'],
    description: 'Three round tables, twelve white folding chairs and two big sun umbrellas. Seats a whole street party.',
    pickup: 'Harbour Lane — you’ll want a van or two trips in a hatchback.',
    care: 'Wipe them down after use, please.' },
  { key: 'washer', owner: 'theo', title: 'Pressure washer', category: 'Home & Garden', maxDays: 2, photo: ['pressure-washer.jpg'],
    description: 'Gas-powered pressure washer with a patio-cleaner attachment. Decks and driveways look brand new.',
    pickup: 'Harbour Lane, weekend mornings.',
    care: 'Return it with a little fuel in the tank and drain the water line.' },
];

/** Move the seed clock to `offset` days from the real today, at a daytime hour in the community. */
function makeClock(base: string) {
  return (offset: number, hourUtc = 16) => {
    const day = addDays(base, offset);
    setClock(() => new Date(`${day}T${String(hourUtc).padStart(2, '0')}:00:00Z`));
    return day;
  };
}

export function seed(db: DB, dataDir: string) {
  if (one(db, `SELECT 1 FROM users LIMIT 1`)) return false;
  const uploadDir = join(dataDir, 'uploads');
  mkdirSync(uploadDir, { recursive: true });

  const previousClock = getClock();
  try {
    seedStory(db, uploadDir);
  } finally {
    setClock(previousClock);
  }
  return true;
}

function seedStory(db: DB, uploadDir: string) {
  const T = today();
  const at = makeClock(T);
  const d = (n: number) => addDays(T, n);

  at(-120);
  const joined = new Date().toISOString();
  for (const p of people) {
    run(db, `INSERT INTO users (id, name, first_name, neighbourhood, bio, avatar_hue, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      p.id, p.name, p.first, p.hood, p.bio, p.hue, joined);
  }

  const itemId: Record<string, string> = {};
  itemsToSeed.forEach((it, i) => {
    at(-90 + i);
    const created = new Date().toISOString();
    let imageUrl: string | null = null;
    const photo = it.photo.find((p) => existsSync(join(PHOTO_DIR, p)));
    if (photo) {
      const fileName = `seed-${photo}`;
      copyFileSync(join(PHOTO_DIR, photo), join(uploadDir, fileName));
      imageUrl = `/uploads/${fileName}`;
    }
    const id = `item-${it.key}`;
    itemId[it.key] = id;
    run(db, `INSERT INTO items (id, owner_id, title, description, category, image_url, max_days, pickup_notes, care_notes, hidden, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      id, it.owner, it.title, it.description, it.category, imageUrl, it.maxDays, it.pickup, it.care, created, created);
  });

  const req = (who: string, item: string, start: number, end: number, note = '') =>
    L.requestLoan(db, who, { itemId: itemId[item], startDate: d(start), endDate: d(end), note }).id;
  const good = (notes = '') => ({ condition: 'good', notes, photoIds: [] });

  // 1. Two overlapping requests waiting on Sam (tent) — only one can be approved.
  at(-2, 15);
  req('priya', 'tent', 5, 8, 'Taking my nieces to Algonquin for the long weekend!');
  at(-1, 20);
  req('maya', 'tent', 6, 9, 'Planning a quiet couple of nights by the lake. Happy to pick up the evening before.');

  // 2. Sam has Maya's drill and it's two days late.
  at(-9);
  let id = req('sam', 'drill', -6, -2, 'Putting up shelves in the kids’ room.');
  L.approve(db, 'maya', id, { note: 'Of course!' });
  at(-6, 14);
  L.markReady(db, 'maya', id, { note: 'In the blue bin on the porch.', report: good('Both batteries charged, all bits in the case.') });
  at(-6, 22);
  L.confirmPickup(db, 'sam', id, {});

  // 3. Maya is borrowing Priya's projector; Theo has it booked right after.
  at(-4);
  id = req('maya', 'projector', -2, 2, 'Backyard movie night for my sister’s birthday.');
  L.approve(db, 'priya', id, {});
  at(-3);
  const theoProjector = req('theo', 'projector', 4, 6, 'Street party slideshow!');
  L.approve(db, 'priya', theoProjector, {});
  at(-2, 14);
  L.markReady(db, 'priya', id, { note: 'Screen is in the long bag.' });
  at(-2, 23);
  L.confirmPickup(db, 'maya', id, { report: good('Small scuff on the lid, otherwise perfect.') });

  // 4. Theo would like Maya's stand mixer.
  at(-1, 18);
  req('theo', 'mixer', 2, 4, 'Baking for the bake sale — I promise to share.');

  // 5. Sam's paddleboard is ready for Maya to pick up today.
  at(-5);
  id = req('maya', 'paddle', 0, 2, 'First time trying it — wish me luck!');
  L.approve(db, 'sam', id, { note: 'You’ll love it. The pump is in the backpack.' });
  at(-1, 21);
  L.markReady(db, 'sam', id, { note: 'On the front porch, leaning by the door.', report: good('Inflated and checked last night, no leaks.') });

  // 6. A past loan where Maya and Priya saw the returned item differently.
  at(-25);
  id = req('priya', 'sewing', -21, -10, 'Hemming curtains for the new flat.');
  L.approve(db, 'maya', id, {});
  at(-21, 15);
  L.markReady(db, 'maya', id, { report: good('Serviced last month, runs smoothly.') });
  L.confirmPickup(db, 'priya', id, {});
  at(-10, 17);
  L.startReturn(db, 'priya', id, { report: { condition: 'good', notes: 'Worked great, thanks! Cleaned out the lint.', photoIds: [] } });
  at(-9, 15);
  L.confirmReturn(db, 'maya', id, { report: { condition: 'damaged', agrees: false, notes: 'The bobbin cover is cracked — it was fine before. Not a big deal but wanted it noted.', photoIds: [] } });
  at(-9, 20);
  L.addFollowUp(db, 'priya', id, { report: { condition: 'worn', notes: 'I didn’t notice the crack, sorry! Happy to split a replacement cover.', photoIds: [] } });
  L.addMessage(db, 'maya', id, { body: 'Thanks Priya, that’s kind. I found one for $8 — let’s call it even.' });

  // 7. Sam returned the party tables last month, all good.
  at(-40);
  id = req('sam', 'tables', -35, -33, 'Kid’s birthday in the park.');
  L.approve(db, 'theo', id, {});
  at(-35);
  L.markReady(db, 'theo', id, {});
  L.confirmPickup(db, 'sam', id, {});
  at(-33, 18);
  L.startReturn(db, 'sam', id, { report: good('Wiped down — all three tables, twelve chairs and both umbrellas.') });
  at(-33, 21);
  L.confirmReturn(db, 'theo', id, { report: { ...good('All here, thanks Sam!'), agrees: true } });

  // 8. Sam is bringing Maya's ladder back — Maya needs to confirm.
  at(-5);
  id = req('sam', 'ladder', -3, -1, 'Painting the hallway ceiling.');
  L.approve(db, 'maya', id, {});
  at(-3);
  L.markReady(db, 'maya', id, {});
  L.confirmPickup(db, 'sam', id, {});
  at(-1, 22);
  L.startReturn(db, 'sam', id, { report: good('Back against your side fence. No paint on it, promise.') });

  // 9. Theo has paused lending the pressure washer, but Priya's reservation stands.
  at(-6);
  id = req('priya', 'washer', 3, 4, 'Deck cleaning before winter.');
  L.approve(db, 'theo', id, {});
  at(-1);
  run(db, `UPDATE items SET hidden = 1 WHERE id = ?`, itemId.washer);

  // 10. Theo has Sam's bike trailer and asked for a few more days.
  at(-4);
  id = req('theo', 'trailer', -3, 1, 'Hauling camping gear to the cottage.');
  L.approve(db, 'sam', id, {});
  at(-3);
  L.markReady(db, 'sam', id, {});
  L.confirmPickup(db, 'theo', id, {});
  at(0, 14);
  L.proposeExtension(db, 'theo', id, { endDate: d(4), note: 'We’re staying an extra weekend — would that be OK?' });

  // 11. Priya is borrowing Sam's backpack next month (upcoming reservation).
  at(-2);
  id = req('priya', 'backpack', 12, 20, 'Hiking the Bruce Trail!');
  L.approve(db, 'sam', id, {});

}

if (import.meta.main) {
  const dataDir = defaultDataDir();
  if (process.argv.includes('--reset')) {
    for (const f of ['borrowbox.db', 'borrowbox.db-wal', 'borrowbox.db-shm']) rmSync(join(dataDir, f), { force: true });
    rmSync(join(dataDir, 'uploads'), { recursive: true, force: true });
  }
  const db = openDatabase(join(dataDir, 'borrowbox.db'));
  const seeded = seed(db, dataDir);
  db.close();
  console.log(seeded ? `Seeded demo community into ${dataDir}` : 'Database already has data — use --reset to start over.');
}
