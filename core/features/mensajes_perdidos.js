export async function revisarMensajesPerdidos(client, procesarConIA) {
  try {
    console.log("Revisando mensajes perdidos...");
    const chats = await client.getChats();
    for (const chat of chats) {
      if (chat.isGroup) continue;
      if (chat.unreadCount <= 0) continue;
      const mensajes = await chat.fetchMessages({ limit: chat.unreadCount });
      for (const msg of mensajes) {
        if (msg.fromMe) continue;
        if (msg.from === "status@broadcast") continue;
        const hace = Date.now() - msg.timestamp * 1000;
        if (hace > 30 * 60 * 1000) continue;
        console.log("Mensaje perdido de [" + msg.from + "]: " + msg.body);
        await new Promise(r => setTimeout(r, 1500));
        await client.sendMessage(msg.from, "Estaba reiniciando y me perdí tu mensaje. Déjame responderlo:");
        await procesarConIA(msg.from, msg.body || "", client);
      }
      await chat.sendSeen();
    }
    console.log("Revision de mensajes perdidos completada");
  } catch (err) {
    console.error("Error revisando mensajes perdidos:", err.message);
  }
}
