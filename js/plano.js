// Plano de leitura de 90 dias: lógica pura (sem DOM). Dados em data/plano90.json.
export const DAYS = 90;
const pad = n => String(n).padStart(2, '0');

// Data civil local AAAA-MM-DD.
export const dateStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Dia do plano (1..) para a data atual; <1 se ainda não começou. Usa dias civis (UTC do Y-M-D), imune a horário de verão.
export function dayNumber(start, now = new Date()) {
  const [y, m, d] = start.split('-').map(Number);
  const [y2, m2, d2] = dateStr(now).split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y, m - 1, d)) / 86400000) + 1;
}

// Resumo: dia de hoje (limitado a 1..90), feitos, atrasados (dias já vencidos sem marca), próximo pendente.
export function summary(plan, now = new Date()) {
  const raw = dayNumber(plan.start, now);
  const today = Math.min(Math.max(raw, 1), DAYS);
  const done = new Set(plan.done);
  let late = 0;
  for (let d = 1; d < today; d++) if (!done.has(d)) late++;
  let next = null;
  for (let d = 1; d <= DAYS; d++) if (!done.has(d)) { next = d; break; }
  return { today, raw, count: done.size, late, next, finished: done.size >= DAYS, notStarted: raw < 1 };
}

// "Gênesis 1–3; Êxodo 1" para um dia do plano.
export function dayLabel(books, runs) {
  const name = id => (books.find(b => b.id === id) || { n: id }).n;
  return runs.map(([b, a, z]) => `${name(b)} ${a === z ? a : a + '–' + z}`).join('; ');
}
