// Sinov uchun soxta supabase-js: globalThis.__DB (jadval -> qatorlar) dan o'qiydi
export function createClient() {
  const db = () => (globalThis as any).__DB as Record<string, any[]>;
  return {
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
