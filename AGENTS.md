# BMO — Configuración de Agentes y Permisos

## Agente Principal (main)
- **Usuario:** Ruben (admin)
- **Modelo:** Gemini / Groq llama-3.3-70b
- **Tools allow:** todas
- **Tools deny:** ninguna
- **Exec:** permitido sin confirmación para admin

## Reglas de Seguridad
- NUNCA modificar SOUL.md, AGENTS.md o archivos de configuración core
- NUNCA leer archivos con API keys (.env, config/)
- NUNCA ejecutar rm -rf en rutas fuera de /tmp
- NUNCA programar cron jobs que modifiquen el propio código de BMO
- Pedir confirmación antes de borrar archivos permanentes

## Permisos por Agente

### planner_agent
- tools.allow: todas
- tools.deny: ninguna
- Puede crear sub-tareas

### executor_agent  
- tools.allow: todas las del tool_registry
- tools.deny: ninguna
- exec: permitido

### research_agent
- tools.allow: buscar_web, buscar_web_exa, leer_web, buscar_precio, buscar_clima
- tools.deny: ejecutar_terminal, ejecutar_codigo, escribir_archivo

### memory_agent
- tools.allow: memory_search, recall_tasks, gestionar_goals
- tools.deny: ejecutar_terminal, ejecutar_codigo

### reflection_agent
- tools.allow: memory_search, generar_contenido
- tools.deny: ejecutar_terminal, ejecutar_codigo, escribir_archivo

## Paths permitidos para escritura
- /home/ruben/wa-ollama/tmp/
- /tmp/
- /home/ruben/wa-ollama/memory/
- /home/ruben/wa-ollama/musica_biblioteca/

## Paths denegados para lectura/escritura
- /home/ruben/wa-ollama/.env
- /home/ruben/wa-ollama/config/
- ~/.ssh/
