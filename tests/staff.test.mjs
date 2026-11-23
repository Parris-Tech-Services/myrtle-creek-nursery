import test from 'node:test';
import assert from 'node:assert/strict';
import { displayNames, toMin, personHours, totalPersonHours, netPerHour, peopleText } from '../js/staff.js';

test('time parsing', () => { assert.equal(toMin('08:30'), 510); assert.equal(toMin(''), null); assert.equal(toMin('x'), null); });
test('own times win, day set-up and pack-up are the defaults', () => {
  const day = { setupTime: '06:30', packupTime: '14:00', staff: [{ name: 'Dan' }, { name: 'Sam', arrive: '08:00', leave: '13:00' }, { name: 'Lee', arrive: '09:00' }] };
  assert.equal(personHours(day.staff[0], day), 7.5);
  assert.equal(personHours(day.staff[1], day), 5);
  assert.equal(personHours(day.staff[2], day), 5);    // own arrive, default pack-up
  assert.equal(totalPersonHours(day), 17.5);
  assert.equal(peopleText(day), 'Dan, Sam, Lee');
});
test('unknown or backwards times count as no hours; net per person-hour', () => {
  assert.equal(personHours({ name: 'A' }, {}), null);
  assert.equal(personHours({ arrive: '10:00', leave: '09:00' }, {}), null);
  const day = { staff: [{ name: 'A', arrive: '07:00', leave: '16:30' }] };   // 9.5 h
  assert.equal(netPerHour(19000, day), 2000);
  assert.equal(netPerHour(100, { staff: [] }), null);
});

test('chips show first names only when unique', () => {
  assert.deepEqual(displayNames(['Sam Green', 'Alex Brown']), { 'Sam Green': 'Sam', 'Alex Brown': 'Alex' });
  assert.deepEqual(displayNames(['Sam Lee', 'Sam Ng', 'Ann Fox']), { 'Sam Lee': 'Sam Lee', 'Sam Ng': 'Sam Ng', 'Ann Fox': 'Ann' });
});
