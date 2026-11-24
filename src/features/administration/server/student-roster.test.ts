import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { createTestDatabase } from './test-db';

const testDb = await createTestDatabase();
const { previewRoster, importRoster } = await import('./student-roster');
const { queryOne } = await import('./database');
const { setup, login } = await import('../../auth/server/auth');

await setup({ name: 'Docente', username: 'docente@pruebas.edu', password: 'Clave-docente-prueba' });

async function workbook(rows: (string | number)[][], numericFormat?: string) {
  const book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet('Alumnos');
  sheet.addRow(['Nombre', 'Correo', 'Identificación']);
  for (const row of rows) sheet.addRow(row);
  if (numericFormat) sheet.getCell('C2').numFmt = numericFormat;
  return Buffer.from(await book.xlsx.writeBuffer());
}

test('previsualiza sin exponer identificaciones y conserva ceros iniciales', async () => {
  const buffer = await workbook([['Ana Prueba', 'ANA@PRUEBAS.EDU', '00091234']]);
  const preview = await previewRoster(buffer);
  assert.equal(preview.ready, 1);
  assert.equal(preview.rows[0].email, 'ana@pruebas.edu');
  assert.equal(preview.rows[0].identificationLength, 8);
  assert.ok(!JSON.stringify(preview).includes('00091234'));
  await importRoster(buffer, {
    fingerprint: preview.fingerprint,
    subjectIds: ['diseno-web-1'],
    skipErrors: false,
    enrollExisting: false,
  });
  assert.equal(
    (await login({ username: 'ana@pruebas.edu', password: '00091234' })).role,
    'student'
  );
});

test('preserva formato numérico de identificación con ceros', async () => {
  const buffer = await workbook([['Beto Prueba', 'beto@pruebas.edu', 1234]], '000000');
  const preview = await previewRoster(buffer);
  assert.equal(preview.rows[0].identificationLength, 6);
  await importRoster(buffer, {
    fingerprint: preview.fingerprint,
    subjectIds: [],
    skipErrors: false,
    enrollExisting: false,
  });
  assert.equal((await login({ username: 'beto@pruebas.edu', password: '001234' })).role, 'student');
});

test('detecta correos inválidos, docentes y duplicados sin crear cuentas', async () => {
  const buffer = await workbook([
    ['Uno', 'correo-invalido', '123'],
    ['Docente', 'docente@pruebas.edu', '456'],
    ['Nuevo', 'nuevo@pruebas.edu', '789'],
    ['Duplicado', 'NUEVO@pruebas.edu', '999'],
  ]);
  const preview = await previewRoster(buffer);
  assert.equal(preview.errors, 3);
  assert.equal(preview.ready, 1);
  await assert.rejects(
    importRoster(buffer, {
      fingerprint: preview.fingerprint,
      subjectIds: [],
      skipErrors: false,
      enrollExisting: false,
    })
  );
  assert.equal(
    await queryOne('SELECT id FROM users WHERE username = $1', ['nuevo@pruebas.edu']),
    null
  );
});

test('importar filas válidas exige omisión explícita y no permite cambiar el archivo', async () => {
  const buffer = await workbook([
    ['Válido', 'valido@pruebas.edu', '123'],
    ['Inválido', 'error', '456'],
  ]);
  const preview = await previewRoster(buffer);
  await assert.rejects(
    importRoster(buffer, {
      fingerprint: 'archivo-cambiado',
      subjectIds: [],
      skipErrors: true,
      enrollExisting: false,
    })
  );
  const result = await importRoster(buffer, {
    fingerprint: preview.fingerprint,
    subjectIds: [],
    skipErrors: true,
    enrollExisting: false,
  });
  assert.equal(result.created, 1);
  assert.equal(result.skippedErrors, 1);
  assert.equal((await login({ username: 'valido@pruebas.edu', password: '123' })).role, 'student');
});

test('un correo existente conserva su contraseña y puede recibir asignaciones', async () => {
  const buffer = await workbook([['Ana actualizada', 'ana@pruebas.edu', 'otra-identificacion']]);
  const preview = await previewRoster(buffer);
  assert.equal(preview.existing, 1);
  const result = await importRoster(buffer, {
    fingerprint: preview.fingerprint,
    subjectIds: ['robotica-servicio'],
    skipErrors: false,
    enrollExisting: true,
  });
  assert.equal(result.created, 0);
  assert.equal(result.enrolled, 1);
  assert.equal(
    (await login({ username: 'ana@pruebas.edu', password: '00091234' })).name,
    'Ana Prueba'
  );
  await assert.rejects(async () =>
    login({ username: 'ana@pruebas.edu', password: 'otra-identificacion' })
  );
});

test('limpia puntos y separadores en la identificación y permite iniciar sesión sin puntos', async () => {
  const buffer = await workbook([['Carlos Cédula', 'carlos.cedula@pruebas.edu', '1.025.761.967']]);
  const preview = await previewRoster(buffer);
  assert.equal(preview.ready, 1);
  assert.equal(preview.rows[0].identificationLength, 10);
  assert.ok(preview.rows[0].warning?.includes('Puntos o separadores'));
  await importRoster(buffer, {
    fingerprint: preview.fingerprint,
    subjectIds: [],
    skipErrors: false,
    enrollExisting: false,
  });
  // El alumno puede iniciar sesión con la identificación limpia sin puntos
  assert.equal(
    (await login({ username: 'carlos.cedula@pruebas.edu', password: '1025761967' })).role,
    'student'
  );
});

test('detecta encabezados en filas intermedias y encabezados institucionales (Aprendiz, Cédula)', async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Alumnos');
  sheet.addRow(['CENTRO DE FORMACION - LISTADO']);
  sheet.addRow(['Nombres y Apellidos del Aprendiz', 'Correo Electrónico', 'Número de Documento']);
  sheet.addRow(['Estudiante Sena', 'sena.aprendiz@pruebas.edu', '1035305165']);
  const buffer = Buffer.from(await book.xlsx.writeBuffer());
  const preview = await previewRoster(buffer);
  assert.equal(preview.ready, 1);
  assert.equal(preview.rows[0].name, 'Estudiante Sena');
  assert.equal(preview.rows[0].email, 'sena.aprendiz@pruebas.edu');
});

after(async () => {
  await testDb.adapter.close();
});
