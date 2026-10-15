export function maskEvolutionGoContact(senderJid: string): string {
  const match = /^([0-9]{4,})@s\.whatsapp\.net$/.exec(senderJid.trim());
  const digits = match?.[1];
  return digits === undefined ? "WhatsApp" : `WhatsApp \u2022\u2022\u2022\u2022 ${digits.slice(-4)}`;
}
