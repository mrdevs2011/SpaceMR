/**
 * modules/settings/settings.js
 * SpaceMR Sozlamalar (Settings) boshqaruv markazi
 */
import {
  PERMISSIONS_CONFIG,
  isPermissionAllowed,
  requirePermission,
  setAppPermissionState,
  queryBrowserPermission,
  getCombinedPermissionState,
  renderPermissionsUI,
  updatePermissionRowUI,
  initPermissionsModule
} from './permissions.js';

export {
  PERMISSIONS_CONFIG,
  isPermissionAllowed,
  requirePermission,
  setAppPermissionState,
  queryBrowserPermission,
  getCombinedPermissionState,
  renderPermissionsUI,
  updatePermissionRowUI,
  initPermissionsModule
};

/**
 * Sozlamalar bo'limlarini initsializatsiya qilish
 */
export function initSettings() {
  initPermissionsModule();
}

// Avtomatik yuklanish
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSettings);
  } else {
    initSettings();
  }
}
