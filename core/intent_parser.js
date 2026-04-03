// Parser de intención y entidades
export function parsearIntent(texto) {
  const t = texto.toLowerCase();
  const intent = {
    tipo: null,
    frecuencia: null,
    diasSemana: [],
    hora: null,
    accion: null,
    origen: null,
    destino: null,
    ciudad: null,
    mensaje: null
  };

  // Frecuencia
  if (/todos los d[ií]as|cada d[ií]a|diariamente|siempre/i.test(t)) intent.frecuencia = "diaria";
  else if (/cada semana|semanal/i.test(t)) intent.frecuencia = "semanal";
  else if (/solo los lunes/i.test(t)) { intent.frecuencia = "semanal"; intent.diasSemana = [1]; }
  else if (/solo los martes/i.test(t)) { intent.frecuencia = "semanal"; intent.diasSemana = [2]; }
  else if (/solo los mi[eé]rcoles/i.test(t)) { intent.frecuencia = "semanal"; intent.diasSemana = [3]; }
  else if (/solo los jueves/i.test(t)) { intent.frecuencia = "semanal"; intent.diasSemana = [4]; }
  else if (/solo los viernes/i.test(t)) { intent.frecuencia = "semanal"; intent.diasSemana = [5]; }
  else if (/fines? de semana/i.test(t)) { intent.frecuencia = "semanal"; intent.diasSemana = [0,6]; }

  // Hora
  const horaMatch = t.match(/a las (\d{1,2})(?::(\d{2}))?\s*(am|pm|de la noche|de la ma[ñn]ana)?/i);
  if (horaMatch) {
    let h = parseInt(horaMatch[1]);
    const min = parseInt(horaMatch[2] || "0");
    const mod = (horaMatch[3] || "").toLowerCase();
    if ((mod === "pm" || mod === "de la noche") && h < 12) h += 12;
    if ((mod === "am" || mod === "de la mañana") && h === 12) h = 0;
    intent.hora = h + ":" + String(min).padStart(2,"0");
  }

  // Tipo de accion
  if (/tr[aá]fico|ruta|como llegar|tiempo de traslado/i.test(t)) {
    intent.tipo = "trafico";
    // Extraer origen y destino
    const deMatch = t.match(/de\s+([^a]+?)\s+a\s+([^,]+?)(?:\s+todos|\s+cada|\s+a las|\s+siempre|\s*$)/i);
    if (deMatch) {
      intent.origen = deMatch[1].trim();
      intent.destino = deMatch[2].trim();
    }
  } else if (/clima|temperatura|lluvia|pron[oó]stico/i.test(t)) {
    intent.tipo = "clima";
    const ciudadM = t.match(/clima.*?(?:de|en)\s+([a-záéíóúñ\s]+?)(?:\s+a las|$)/i);
    if (ciudadM) intent.ciudad = ciudadM[1].trim();
  } else if (/precio.*d[oó]lar|dolar|tipo de cambio/i.test(t)) {
    intent.tipo = "dolar";
  } else if (/noticias?/i.test(t)) {
    intent.tipo = "noticias";
  } else {
    intent.tipo = "mensaje";
    intent.mensaje = texto;
  }

  // Es recordatorio?
  intent.esRecordatorio = !!(intent.hora || intent.frecuencia);

  return intent;
}
