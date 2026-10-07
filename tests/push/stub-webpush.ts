// Sinov uchun soxta web-push: yuborilgan payload'larni yig'adi
export const sent: { sub: unknown; payload: any }[] = [];
export default {
  setVapidDetails() {},
  async sendNotification(sub: string, msg: string) { sent.push({ sub, payload: JSON.parse(msg) }); },
};
