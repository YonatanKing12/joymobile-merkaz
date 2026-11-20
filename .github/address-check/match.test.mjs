// node --test .github/address-check/match.test.mjs
// The address check's matching against the lists in assets/ (the real files, not a fixture): the failures Israel Post
// returned through Shipper on 19 and 20/11/2026, and the city spellings of the national store's orders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cityIndex, matchCity, searchCities, checkStreet, searchStreets, splitStreetLine, HOUSE_NUMBER } from '../../assets/address-match.js';

const assets = path.join(import.meta.dirname, '../../assets');
const read = (f) => JSON.parse(fs.readFileSync(path.join(assets, f), 'utf8'));
const { localities } = read('il-localities.json');
const ix = cityIndex(localities);
function streetsOf(city) {
  const c = ix.byName.get(city);
  if (c?.shard == null) return [];
  return read(`il-streets-${String(c.shard).padStart(2, '0')}.json`)[city].split('|');
}

test('the lists: every locality with streets points at a file that has it', () => {
  assert.ok(localities.length > 1200);
  let withStreets = 0;
  for (const [name, , shard] of localities) {
    if (shard == null) continue;
    withStreets++;
    assert.ok(streetsOf(name).length > 0, name);
  }
  assert.ok(withStreets > 800);
});

test('cities: listed names stay as they are', () => {
  for (const c of ['חיפה', 'תל אביב - יפו', 'באר שבע', 'כוכב יאיר-צור יגאל', 'פרדס חנה-כרכור']) {
    const r = matchCity(c, ix);
    assert.equal(r.city?.name, c);
    assert.equal(r.kind, 'exact');
  }
});

test('cities: the spellings and languages of the orders are put right with confidence', () => {
  const cases = {
    'תל אביב': 'תל אביב - יפו',
    'תל אביב-יפו': 'תל אביב - יפו',
    'מודיעין מכבים רעות': 'מודיעין-מכבים-רעות',
    'נס-ציונה': 'נס ציונה',
    'קריית גת': 'קרית גת',
    'קריית מלאכי': 'קרית מלאכי',
    'אשקלון והסביבה': 'אשקלון',
    'Haifa': 'חיפה',
    'Jerusalem': 'ירושלים',
    'Jerusalem/ירושלים': 'ירושלים',
    'Beersheba': 'באר שבע',
    'Tel aviv': 'תל אביב - יפו',
    'Um el fahem': 'אום אל-פחם',
    'Yehud': 'יהוד-מונוסון',
    'Arad': 'ערד',
    'Dimona': 'דימונה',
    'קדימה': 'קדימה-צורן',
    'כפר סולם': 'סולם',
    'קיבוץ דפנה': 'דפנה',
    '‏באר שבע‏': 'באר שבע',
  };
  for (const [typed, listed] of Object.entries(cases)) {
    const r = matchCity(typed, ix);
    assert.equal(r.city?.name, listed, typed);
    assert.equal(r.confident, true, typed);
  }
});

test('cities: a name with a word more is only a suggestion; nonsense is nothing', () => {
  const r = matchCity('יפיע נצרת', ix);
  assert.equal(r.city?.name, 'יפיע');
  assert.equal(r.confident, false);
  assert.equal(matchCity('עיר שלא קיימת בכלל', ix).city, null);
  assert.equal(matchCity('', ix).city, null);
});

test('cities: the list under the field', () => {
  assert.equal(searchCities('חיפ', ix)[0].name, 'חיפה');
  assert.ok(searchCities('תל אב', ix).some((c) => c.name === 'תל אביב - יפו'));
  assert.ok(searchCities('קריית ג', ix).some((c) => c.name === 'קרית גת'));
  assert.equal(searchCities('haifa', ix)[0].name, 'חיפה');
});

test('streets: the three refused on 20/11/2026 are matched to the listed name', () => {
  const gefen = checkStreet('הגפן', streetsOf('אלפי מנשה'));
  assert.equal(gefen.suggestion, 'גפן');
  assert.equal(gefen.confident, true);
  const dotan = checkStreet('עמק דותן', streetsOf('כוכב יאיר-צור יגאל'));
  assert.equal(dotan.suggestion, 'עמק דותן צור יגאל');
  assert.equal(dotan.confident, true);
  const yaar = checkStreet('יעכ בן שמן', streetsOf('מודיעין-מכבים-רעות'));
  assert.equal(yaar.suggestion, 'יער בן שמן');
  assert.equal(yaar.confident, true);
});

test('streets: listed, unknown, and the list under the field', () => {
  const haifa = streetsOf('חיפה');
  assert.equal(checkStreet('הרצל', haifa).known, true);
  const none = checkStreet('רחוב שאין כמותו', haifa);
  assert.equal(none.suggestion, null);
  assert.equal(none.known, false);
  assert.ok(searchStreets('הרצ', haifa).includes('הרצל'));
  assert.ok(searchStreets('רחוב הרצל', haifa).includes('הרצל'));
});

test('the street line: a number at the end or the start, only a number, none', () => {
  assert.deepEqual(splitStreetLine('הגפן 50'), { street: 'הגפן', number: '50' });
  assert.deepEqual(splitStreetLine('50 הגפן'), { street: 'הגפן', number: '50' });
  assert.deepEqual(splitStreetLine('7'), { street: '', number: '7' });
  assert.deepEqual(splitStreetLine('הגפן'), { street: 'הגפן', number: '' });
  assert.ok(HOUSE_NUMBER.test('12'));
  assert.ok(HOUSE_NUMBER.test('12א'));
  assert.ok(!HOUSE_NUMBER.test('12/3'));
  assert.ok(!HOUSE_NUMBER.test('דירה 4'));
});
