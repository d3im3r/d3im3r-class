import { Pool } from 'pg';
import { randomBytes, scryptSync } from 'node:crypto';
import { db } from '../src/features/administration/server/database';

function passwordHash(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(password, salt, 64).toString('hex');
}

async function main() {
  const newPassword = process.argv[2];
  if (!newPassword || newPassword.length < 10) {
    console.log('\n❌ Debes indicar una contraseña de al menos 10 caracteres.');
    console.log('Ejemplo: npm run reset-password "MiNuevaClaveSegura2026"\n');
    process.exit(1);
  }

  const targetUsername = process.argv[3]?.toLowerCase();
  const hashed = passwordHash(newPassword);
  let updatedAny = false;

  // Actualizar en Supabase PostgreSQL si DATABASE_URL está presente
  if (process.env.DATABASE_URL) {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });

    try {
      const userRes = targetUsername
        ? await pool.query('SELECT id, name, username FROM users WHERE LOWER(username) = $1', [targetUsername])
        : await pool.query("SELECT id, name, username FROM users WHERE role = 'teacher' LIMIT 1");

      if (userRes.rows.length > 0) {
        const user = userRes.rows[0];
        const now = new Date().toISOString();
        await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashed, user.id]);
        await pool.query('UPDATE account SET password = $1, "updatedAt" = $2 WHERE "userId" = $3', [hashed, now, user.id]);
        await pool.query('DELETE FROM login_attempts WHERE LOWER(username) = $1', [user.username.toLowerCase()]);
        console.log(`✅ Contraseña actualizada en Supabase para el docente "${user.name}" (${user.username}).`);
        updatedAny = true;
      } else {
        console.log('⚠️ No se encontró la cuenta docente en Supabase.');
      }
    } finally {
      await pool.end();
    }
  }

  // Actualizar en base de datos local SQLite
  try {
    const sql = db();
    const localUser = (targetUsername
      ? sql.prepare('SELECT id, name, username FROM users WHERE LOWER(username) = ?').get(targetUsername)
      : sql.prepare("SELECT id, name, username FROM users WHERE role = 'teacher' LIMIT 1").get()) as { id: string; name: string; username: string } | undefined;

    if (localUser) {
      const now = new Date().toISOString();
      sql.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, localUser.id);
      sql.prepare('UPDATE account SET password = ?, updatedAt = ? WHERE userId = ?').run(hashed, now, localUser.id);
      sql.prepare('DELETE FROM login_attempts WHERE LOWER(username) = ?').run(localUser.username.toLowerCase());
      console.log(`✅ Contraseña actualizada en SQLite local para "${localUser.name}".`);
      updatedAny = true;
    }
  } catch (err: any) {
    console.error('Error SQLite local:', err.message);
  }

  if (updatedAny) {
    console.log('\n🎉 ¡Listo! Ya puedes iniciar sesión con tu nueva contraseña.\n');
  } else {
    console.log('\n⚠️ No se encontró ninguna cuenta docente para actualizar.\n');
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
