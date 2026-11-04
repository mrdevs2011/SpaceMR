// Sinov uchun soxta supabase-js: globalThis.__DB (jadval -> qatorlar) dan o'qiydi
export function createClient() {
  const db = () => (globalThis as any).__DB as Record<string, any[]>;
  return {
    auth: { getUser: async (token: string) => ({ data: { user: token === 'valid-user-token' ? { id: 'u1' } : null }, error: token === 'valid-user-token' ? null : new Error('invalid token') }) },
    storage: { from: (_bucket: string) => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `https://spacemr.vercel.app/storage/${path}` } }) }) },
    from(table: string) {
      let rows = [...(db()[table] ?? [])];
      const q: any = {
        select() { return q; },
        eq(c: string, v: unknown) { rows = rows.filter((r) => r[c] === v); return q; },
        neq(c: string, v: unknown) { rows = rows.filter((r) => r[c] !== v); return q; },
        in(c: string, vs: unknown[]) { rows = rows.filter((r) => vs.includes(r[c])); return q; },
        delete() { return q; },
        maybeSingle: async () => ({ data: rows[0] ?? null }),
        then(res: any) { res({ data: rows }); },
      };
      return q;
    },
  };
}
