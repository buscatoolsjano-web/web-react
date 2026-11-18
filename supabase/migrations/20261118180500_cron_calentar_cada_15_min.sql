-- El cron de «calentamiento» del catálogo público (jobid 9): de cada 3 a cada 15 minutos.
--
-- Auditoría de rendimiento 2026-11-18, medido en producción:
--  · Era el MAYOR consumidor de la base: 13.713 corridas, media 4,3 s, máx 59 s,
--    16 h de CPU en 23 días — más que toda la app junta.
--  · Cuando corre traba a los usuarios: a las 17:39 tardó 7,7 s y en ese momento
--    `company_memberships` (1–2 ms en la base) tardó 12,6 s en el navegador.
--  · No calienta nada que haga falta: products tiene 5.408 lecturas de disco
--    contra 2.400 millones de aciertos de caché; los datos ya viven en memoria.
--
-- Cada 15 min sigue refrescando la caché de facetas públicas (que vence a los
-- 10 min y la refresca también el propio catálogo al pedirla) con un 80 % menos de CPU.
select cron.alter_job(
  (select jobid from cron.job where command = 'select app.calentar_catalogo_publico()'),
  schedule => '*/15 * * * *'
);
