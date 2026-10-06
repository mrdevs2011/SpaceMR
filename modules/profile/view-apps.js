/**
 * Ilovalar — /apps (foydalanuvchi ilovalari). Mantiq: modules/apps/apps.js
 */
export async function initView() {
  const m = await import('../apps/apps.js');
  m.mountApps();
}

export function destroyView() {
  import('../apps/apps.js').then(m => m.unmountApps()).catch(() => {});
}
