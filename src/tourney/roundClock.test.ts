import test from 'node:test';
import assert from 'node:assert/strict';
import { RoundClock, pickWinner, roundStartFor, type RoundEndPayload, type KoEventPayload } from './roundClock';

const A = { address: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', gotchiId: 'starter-nvidia-h3-1', cartridgeId: 'c-a' };
const B = { address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', gotchiId: 'starter-apple-h3-1', cartridgeId: 'c-b' };
const ROUND = 10 * 60_000;

function makeClock(startMs: number) {
  let now = startMs;
  const ends: RoundEndPayload[] = [];
  const kos: KoEventPayload[] = [];
  const broadcasts: Array<[string, unknown]> = [];
  const clock = new RoundClock({
    roomId: 'room1',
    roundMs: ROUND,
    now: () => now,
    onRoundEnd: (p) => ends.push(p),
    onKo: (k) => kos.push(k),
    broadcast: (t, p) => broadcasts.push([t, p]),
  });
  return { clock, ends, kos, broadcasts, advance: (ms: number) => { now += ms; } };
}

test('roundStartFor aligns to the wall clock so restarts derive the same roundId', () => {
  const t = Date.UTC(2026, 8, 16, 10, 7, 30);
  assert.equal(roundStartFor(t, ROUND), Date.UTC(2026, 8, 16, 10, 0, 0));
  assert.equal(roundStartFor(Date.UTC(2026, 8, 16, 10, 0, 0), ROUND), Date.UTC(2026, 8, 16, 10, 0, 0));
});

test('pickWinner: most KOs, then damage, then earliest last KO', () => {
  const base = { gotchiId: '', cartridgeId: '', hits: 0 };
  assert.equal(pickWinner([]), null);
  assert.equal(pickWinner([{ ...base, address: 'a', kos: 0, damage: 99, lastKoAt: 0 }]), null);
  const w = pickWinner([
    { ...base, address: 'a', kos: 2, damage: 10, lastKoAt: 5 },
    { ...base, address: 'b', kos: 2, damage: 10, lastKoAt: 3 },
    { ...base, address: 'c', kos: 2, damage: 20, lastKoAt: 9 },
  ]);
  assert.equal(w?.address, 'c');
});

test('round tallies KOs, emits ko events with stable refIds and closes at the boundary', () => {
  const start = Date.UTC(2026, 8, 16, 10, 0, 0);
  const { clock, ends, kos, broadcasts, advance } = makeClock(start + 1000);
  try {
    assert.equal(clock.roundId, `room1-${start}`);
    clock.touch(A);
    clock.touch(B);
    clock.recordHit(A, 12);
    clock.recordHit(B, 3);
    const ko = clock.recordKo(A, B, 40);
    assert.equal(ko.seq, 1);
    assert.equal(ko.refId, `ko:room1:${start}:1:${A.address.toLowerCase()}:${B.address.toLowerCase()}`);
    assert.equal(kos.length, 1);
    assert.equal(kos[0].attacker.address, A.address.toLowerCase());

    advance(ROUND); // past the boundary
    assert.equal(clock.rollIfDue(), true);
    assert.equal(ends.length, 1);
    const end = ends[0];
    assert.equal(end.refId, `round:room1:${start}`);
    assert.equal(end.winner?.address, A.address.toLowerCase());
    assert.equal(end.participants.length, 2);
    assert.equal(end.participants.find((p) => p.address === A.address.toLowerCase())?.kos, 1);
    assert.equal(broadcasts.some(([t]) => t === 'round.end'), true);
    // new round, fresh tally and seq
    assert.equal(clock.roundId, `room1-${start + ROUND}`);
    assert.equal(clock.recordKo(B, A, 10).seq, 1);
  } finally {
    clock.dispose();
  }
});

test('empty rounds are not reported; dispose reports a truncated round with no winner', () => {
  const start = Date.UTC(2026, 8, 16, 10, 0, 0);
  const { clock, ends, advance } = makeClock(start);
  advance(ROUND);
  clock.rollIfDue();
  assert.equal(ends.length, 0, 'nothing happened → nothing reported');
  clock.recordHit(A, 5);
  clock.dispose();
  assert.equal(ends.length, 1);
  assert.equal(ends[0].winner, null);
});
