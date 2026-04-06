import { AuthUI } from './auth-ui.js';
import './db.js';
import './xlsx_loader.js';
import './analytics.js';
import './core.js';

// AuthUI handles the login screen and then calls window.boot()
// which is defined in core.js.
AuthUI.init();

// Global Logout for the UI
window.handleLogout = async () => {
  if (window.DB && window.DB.SyncManager && window.DB.SyncManager.isSyncing()) {
    const wait = confirm('⚠️ SINCRONIZAÇÃO EM ANDAMENTO!\n\nAlguns dados ainda estão sendo enviados para a nuvem. Se você sair agora, poderá perder as últimas alterações.\n\nDeseja sair mesmo assim?');
    if (!wait) return;
  }

  // 1. Stop listeners FIRST so cleared data doesn't re-sync
  if (window.DB && window.DB.stopListeners) window.DB.stopListeners();
  
  // 2. Clear local database
  if (window.DB && window.DB.clearDatabase) await window.DB.clearDatabase();
  
  // 3. Clear in-memory state and reset UI
  if (window.clearState) window.clearState();
  
  // 4. Sign out from Firebase and show login
  AuthUI.logout();
  AuthUI.showLoginScreen();
  
  console.log('AUTH: Logout concluído e dados locais limpos.');
};
