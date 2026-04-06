import { auth, signInWithEmailAndPassword, onAuthStateChanged, signOut, createUserWithEmailAndPassword } from './firebase.js';

export const AuthUI = {
  user: null,
  _firebaseReady: false,

  init() {
    this.injectStyles();
    this.renderLoginScreen();
    
    // Call boot IMMEDIATELY to load local storage data
    if (window.boot) {
      console.log('AUTH: Iniciando app em modo local enquanto aguarda autenticação...');
      window.boot();
    }
    
    // Set a timeout: if Firebase doesn't respond in 5s, dismiss login and go local
    const authTimeout = setTimeout(() => {
      if (!this._firebaseReady) {
        console.warn('AUTH: Firebase demorou demais. Entrando em Modo Local automaticamente.');
        this.hideLoginScreen();
        if (window.updateUserInfo) window.updateUserInfo();
      }
    }, 5000);
    
    onAuthStateChanged(auth, (user) => {
      this._firebaseReady = true;
      clearTimeout(authTimeout);
      
      this.user = user;
      if (user) {
        console.log('Usuário autenticado:', user.email);
        this.hideLoginScreen();
        
        // Start real-time listeners (non-blocking)
        if (window.DB && window.DB.listenForChanges) {
          window.DB.listenForChanges();
        }
        
        // Update UI with user info
        if (window.updateUserInfo) window.updateUserInfo();
      } else {
        console.log('Nenhum usuário autenticado (Modo Local)');
        if (window.DB && window.DB.stopListeners) {
          window.DB.stopListeners();
        }
        // Just ensure user info reflects local mode
        if (window.updateUserInfo) window.updateUserInfo();
      }
    });
  },

  injectStyles() {
    const style = document.createElement('style');
    style.innerHTML = `
      #auth-overlay {
        position: fixed;
        top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(15, 23, 42, 0.9);
        backdrop-filter: blur(8px);
        display: flex; align-items: center; justify-content: center;
        z-index: 9999;
        transition: opacity 0.5s ease;
      }
      .auth-card {
        background: #1e293b;
        padding: 40px;
        border-radius: 20px;
        width: 100%; max-width: 400px;
        box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
        border: 1px solid rgba(255,255,255,0.1);
        text-align: center;
        position: relative;
      }
      .auth-close {
        position: absolute; top: 15px; right: 20px;
        color: #94a3b8; cursor: pointer; font-size: 20px; font-weight: bold;
      }
      .auth-logo {
        font-size: 28px; font-weight: 800; color: #6366f1; margin-bottom: 30px;
      }
      .auth-form input {
        width: 100%; padding: 12px 15px; margin-bottom: 15px;
        background: #0f172a; border: 1px solid rgba(255,255,255,0.1);
        border-radius: 10px; color: #fff; font-size: 14px;
      }
      .auth-btn {
        width: 100%; padding: 12px; background: #6366f1; color: #fff;
        border: none; border-radius: 10px; font-weight: 700; cursor: pointer;
        transition: all 0.3s ease;
      }
      .auth-btn:hover { background: #4f46e5; transform: translateY(-2px); }
      .auth-btn:disabled { opacity: 0.7; cursor: not-allowed; transform: none; }
      .auth-error { color: #ef4444; font-size: 12px; margin-top: 10px; display: none; }
      .auth-switch { margin-top: 20px; font-size: 13px; color: #94a3b8; cursor: pointer; }
      .auth-local-btn { margin-top: 15px; font-size: 11px; color: #6366f1; cursor: pointer; text-decoration: underline; }
    `;
    document.head.appendChild(style);
  },

  renderLoginScreen() {
    if (document.getElementById('auth-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'auth-overlay';
    overlay.innerHTML = `
      <div class="auth-card">
        <div class="auth-close" onclick="AuthUI.hideLoginScreen()" title="Usar Modo Local">✕</div>
        <div class="auth-logo">DubAnalytics</div>
        <h2 style="color:#fff; margin-bottom:10px; font-size:18px">Acesso Premium</h2>
        <p style="color:#94a3b8; margin-bottom:30px; font-size:14px">Faça login para sincronizar seus dados</p>
        
        <form class="auth-form" id="login-form">
          <input type="email" id="auth-email" placeholder="E-mail" required>
          <input type="password" id="auth-password" placeholder="Senha" required>
          <button type="submit" class="auth-btn" id="btn-submit">Entrar</button>
          <div id="auth-error-msg" class="auth-error">Erro ao autenticar</div>
        </form>
        
        <div class="auth-switch" id="auth-toggle-mode">Não tem uma conta? Criar conta</div>
        <div class="auth-local-btn" onclick="AuthUI.hideLoginScreen()">Continuar no Modo Local (offline)</div>
      </div>
    `;
    document.body.appendChild(overlay);

    let isLogin = true;
    const form = document.getElementById('login-form');
    const toggle = document.getElementById('auth-toggle-mode');
    const btnSubmit = document.getElementById('btn-submit');

    toggle.onclick = () => {
      isLogin = !isLogin;
      btnSubmit.innerText = isLogin ? 'Entrar' : 'Criar Conta';
      toggle.innerText = isLogin ? 'Não tem uma conta? Criar conta' : 'Já tem uma conta? Voltar ao login';
    };

    form.onsubmit = async (e) => {
      e.preventDefault();
      const email = document.getElementById('auth-email').value;
      const password = document.getElementById('auth-password').value;
      const errorEl = document.getElementById('auth-error-msg');
      errorEl.style.display = 'none';
      
      try {
        btnSubmit.disabled = true;
        btnSubmit.innerText = 'Autenticando...';
        
        // Add a 15s timeout to prevent infinite "Autenticando..."
        const loginPromise = isLogin
          ? signInWithEmailAndPassword(auth, email, password)
          : createUserWithEmailAndPassword(auth, email, password);
        
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject({ code: 'auth/timeout' }), 15000)
        );
        
        await Promise.race([loginPromise, timeoutPromise]);
        // onAuthStateChanged will handle the rest
        
      } catch (err) {
        console.error(err);
        btnSubmit.disabled = false;
        btnSubmit.innerText = isLogin ? 'Entrar' : 'Criar Conta';
        errorEl.innerText = this.mapError(err.code);
        errorEl.style.display = 'block';
      }
    };
  },

  showLoginScreen() {
    const el = document.getElementById('auth-overlay');
    if (el) {
      el.style.display = 'flex';
      // Reset the form state
      const btn = document.getElementById('btn-submit');
      if (btn) { btn.disabled = false; btn.innerText = 'Entrar'; }
      const err = document.getElementById('auth-error-msg');
      if (err) err.style.display = 'none';
    } else {
      this.renderLoginScreen();
    }
  },

  hideLoginScreen() {
    const el = document.getElementById('auth-overlay');
    if (el) el.style.display = 'none';
  },

  logout() {
    signOut(auth);
  },

  mapError(code) {
    switch (code) {
      case 'auth/user-not-found': return 'Usuário não encontrado.';
      case 'auth/wrong-password': return 'Senha incorreta.';
      case 'auth/invalid-credential': return 'E-mail ou senha incorretos.';
      case 'auth/email-already-in-use': return 'Este e-mail já está em uso.';
      case 'auth/weak-password': return 'A senha deve ter pelo menos 6 caracteres.';
      case 'auth/network-request-failed': return 'Erro de rede. Verifique sua conexão.';
      case 'auth/timeout': return 'Timeout: o servidor demorou demais. Tente novamente.';
      case 'auth/too-many-requests': return 'Muitas tentativas. Aguarde uns minutos.';
      default: return 'Falha na autenticação. Verifique os dados. (' + code + ')';
    }
  }
};

window.AuthUI = AuthUI;
