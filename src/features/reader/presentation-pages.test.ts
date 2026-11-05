import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slideUnits, groupSlidePages } from './presentation-pages';
test('divide listas en unidades sin perder numeración ni elementos', () => {
  const units = slideUnits(
    [
      {
        type: 'list',
        content: '',
        variant: 'enumerate',
        items: [
          [{ type: 'text', content: 'Uno' }],
          [{ type: 'text', content: 'Dos' }],
          [{ type: 'text', content: 'Tres' }],
        ],
      },
    ],
    true
  );
  assert.deepEqual(
    units.map((u) => u.start),
    [1, 2, 3]
  );
  assert.deepEqual(
    units
      .flatMap((u) => u.items ?? [])
      .flat()
      .map((b) => b.content),
    ['Uno', 'Dos', 'Tres']
  );
});
test('el código extenso se reparte conservando todas sus líneas', () => {
  const lines = Array.from({ length: 27 }, (_, i) => `print(${i})`);
  const units = slideUnits([{ type: 'code', content: lines.join('\n'), language: 'python' }], true);
  assert.equal(units.length, 3);
  assert.deepEqual(
    units.flatMap((u) => u.content.split('\n')),
    lines
  );
});
test('agrupa partes por altura sin cortar una unidad', () => {
  const pages = groupSlidePages(
    [
      { top: 0, height: 50 },
      { top: 50, height: 60 },
      { top: 110, height: 40 },
      { top: 150, height: 50 },
    ],
    120
  );
  assert.deepEqual(pages, [
    { start: 0, end: 2, offset: 0 },
    { start: 2, end: 4, offset: 110 },
  ]);
});
test('conserva el encabezado de tablas repartidas en varias partes', () => {
  const rows = [['A', 'B'], ...Array.from({ length: 9 }, (_, i) => [String(i), 'dato'])];
  const units = slideUnits([{ type: 'table', content: '', rows }], true);
  assert.equal(units.length, 3);
  for (const unit of units) assert.deepEqual(unit.rows?.[0], ['A', 'B']);
  assert.equal(units.flatMap((u) => u.rows?.slice(1) ?? []).length, 9);
});
