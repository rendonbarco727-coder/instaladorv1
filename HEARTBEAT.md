# BMO Heartbeat — Checklist Autónomo
# Se ejecuta cada 30 minutos
# Edita este archivo para cambiar el comportamiento sin tocar código

## Checks de Sistema
- [ ] Verificar temperatura del procesador (alerta si >75°C)
- [ ] Verificar RAM disponible (alerta si >80%)
- [ ] Verificar reinicios de PM2 (flush si >500)

## Checks de Memoria
- [ ] Escanear temas frecuentes en conversaciones
- [ ] Detectar huecos de conocimiento
- [ ] Generar goals automáticos si hay 3+ temas

## Checks de Conectividad
- [ ] Verificar conexión a internet (ping google.com)
- [ ] Verificar APIs disponibles (Groq, Gemini, EXA)

## Tareas Proactivas
- [ ] Si son las 08:00 — enviar resumen del día a Ruben
- [ ] Si son las 22:00 — enviar reporte de actividad del día
- [ ] Limpiar /tmp si tiene más de 500MB
